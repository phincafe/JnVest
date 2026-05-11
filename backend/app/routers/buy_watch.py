"""Buy Watch — owner-only "buy on dip" tracker.

Each row is a ticker the owner wants to accumulate at a chosen condition.
Status is computed live from cached daily bars + latest trades:
  - in_zone   → condition met (buy now zone)
  - near      → within 5% of trigger
  - far       → > 5% above trigger
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import BuyTarget
from ..services import alpaca
from ..services.indicators import rsi

router = APIRouter(prefix="/buy-watch", tags=["buy-watch"])

VALID_RULES = {"price", "off_high", "below_sma", "rsi"}


class BuyTargetIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)
    rule: str = Field(default="price")
    target_price: float | None = None
    threshold: float | None = None
    note: str | None = None
    sort_order: int | None = None


def _trigger_price(
    rule: str,
    target_price: float | None,
    threshold: float | None,
    high_52w: float | None,
    sma20: float | None,
    sma50: float | None,
    sma200: float | None,
) -> float | None:
    """Compute the effective $ price at which this rule fires. None if rule
    isn't price-comparable (e.g. RSI rule has no fixed price trigger)."""
    if rule == "price":
        return target_price
    if rule == "off_high":
        if high_52w is None or threshold is None:
            return None
        # threshold is a positive % drawdown (e.g. 15 means "15% off high").
        return high_52w * (1 - threshold / 100.0)
    if rule == "below_sma":
        if threshold == 20:
            return sma20
        if threshold == 50:
            return sma50
        if threshold == 200:
            return sma200
        return None
    return None


def _compute_status(
    last: float, trigger: float | None, rule: str, rsi_val: float | None, threshold: float | None
) -> tuple[str, float | None]:
    """Returns (status, distance_pct). Distance is signed: positive means
    price is ABOVE the trigger (still need to wait), negative means in zone."""
    if rule == "rsi":
        # RSI rule: "in zone" when current RSI <= threshold (oversold).
        if rsi_val is None or threshold is None:
            return ("unknown", None)
        diff = rsi_val - threshold
        if diff <= 0:
            return ("in_zone", diff)
        if diff <= 5:
            return ("near", diff)
        return ("far", diff)
    if trigger is None or trigger <= 0 or last <= 0:
        return ("unknown", None)
    distance_pct = (last - trigger) / trigger * 100.0
    if distance_pct <= 0:
        return ("in_zone", distance_pct)
    if distance_pct <= 5:
        return ("near", distance_pct)
    return ("far", distance_pct)


@router.get("")
async def list_targets(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Returns all buy targets enriched with current price, computed signals
    (52w high, SMAs, RSI), trigger price, and status."""
    rows = (
        db.query(BuyTarget).order_by(BuyTarget.sort_order.asc(), BuyTarget.created_at.asc()).all()
    )
    if not rows:
        return {"targets": []}

    symbols = sorted({r.symbol.upper() for r in rows})
    try:
        trades = await alpaca.latest_trades(symbols)
        # 280 calendar days ≈ enough for 52w high (need ~252 trading days) with buffer.
        bars = await alpaca.daily_bars(symbols, days=280)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e

    out: list[dict[str, Any]] = []
    for r in rows:
        sym = r.symbol.upper()
        sym_bars = bars.get(sym) or []
        trade = trades.get(sym, {})
        last = float(trade.get("p") or 0) or (
            float(sym_bars[-1].get("c") or 0) if sym_bars else 0.0
        )
        closes = [float(b.get("c") or 0) for b in sym_bars if b.get("c")]
        high_52w = max(closes[-252:]) if len(closes) >= 1 else None
        low_52w = min(closes[-252:]) if len(closes) >= 1 else None
        sma20 = sum(closes[-20:]) / 20 if len(closes) >= 20 else None
        sma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else None
        sma200 = sum(closes[-200:]) / 200 if len(closes) >= 200 else None
        rsi_val = rsi(closes, 14)[-1] if len(closes) >= 15 else None

        trigger = _trigger_price(
            r.rule, r.target_price, r.threshold, high_52w, sma20, sma50, sma200
        )
        status, distance = _compute_status(last, trigger, r.rule, rsi_val, r.threshold)
        off_high_pct = ((last - high_52w) / high_52w * 100.0) if (high_52w and last) else None

        out.append(
            {
                "id": r.id,
                "symbol": sym,
                "rule": r.rule,
                "target_price": r.target_price,
                "threshold": r.threshold,
                "note": r.note,
                "sort_order": r.sort_order,
                "last": last,
                "high_52w": high_52w,
                "low_52w": low_52w,
                "off_high_pct": off_high_pct,
                "sma20": sma20,
                "sma50": sma50,
                "sma200": sma200,
                "rsi14": rsi_val,
                "trigger_price": trigger,
                "distance_pct": distance,
                "status": status,
            }
        )

    # Sort: in_zone first, then near, then far — most actionable on top.
    order = {"in_zone": 0, "near": 1, "far": 2, "unknown": 3}
    out.sort(key=lambda x: (order.get(x["status"], 3), x.get("distance_pct") or 0))
    return {"targets": out}


def _require_owner(request: Request) -> None:
    from ..main import is_guest

    if is_guest(request):
        raise HTTPException(status_code=403, detail="Owner only")


@router.post("")
def add_target(
    payload: BuyTargetIn, request: Request, db: Session = Depends(get_db)
) -> dict[str, Any]:
    _require_owner(request)
    if payload.rule not in VALID_RULES:
        raise HTTPException(status_code=400, detail=f"unknown rule '{payload.rule}'")
    sym = payload.symbol.strip().upper()
    if not sym:
        raise HTTPException(status_code=400, detail="symbol is required")
    existing = db.query(BuyTarget).filter(BuyTarget.symbol == sym).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"{sym} is already on the buy watch")
    next_order = db.query(BuyTarget).order_by(BuyTarget.sort_order.desc()).first()
    sort_order = (next_order.sort_order + 1) if next_order else 0
    row = BuyTarget(
        symbol=sym,
        rule=payload.rule,
        target_price=payload.target_price,
        threshold=payload.threshold,
        note=payload.note,
        sort_order=payload.sort_order if payload.sort_order is not None else sort_order,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "symbol": row.symbol}


@router.put("/{target_id}")
def update_target(
    target_id: int, payload: BuyTargetIn, request: Request, db: Session = Depends(get_db)
) -> dict[str, Any]:
    _require_owner(request)
    if payload.rule not in VALID_RULES:
        raise HTTPException(status_code=400, detail=f"unknown rule '{payload.rule}'")
    row = db.query(BuyTarget).filter(BuyTarget.id == target_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    row.rule = payload.rule
    row.target_price = payload.target_price
    row.threshold = payload.threshold
    row.note = payload.note
    if payload.sort_order is not None:
        row.sort_order = payload.sort_order
    db.commit()
    return {"id": row.id, "symbol": row.symbol}


@router.delete("/{target_id}")
def delete_target(
    target_id: int, request: Request, db: Session = Depends(get_db)
) -> dict[str, bool]:
    _require_owner(request)
    db.query(BuyTarget).filter(BuyTarget.id == target_id).delete()
    db.commit()
    return {"ok": True}


# Curated AI-cycle seed list, spanning all layers of the AI capex stack.
# Owner can pick "Seed suggested defaults" in the UI to bulk-add these.
# Tickers already on the watch are skipped (idempotent).
SEED_DEFAULTS: list[dict[str, Any]] = [
    {
        "symbol": "NVDA",
        "rule": "below_sma",
        "threshold": 50,
        "note": "Compute backbone — buy 50DMA dips",
    },
    {
        "symbol": "MSFT",
        "rule": "off_high",
        "threshold": 10,
        "note": "Hyperscaler with real AI revenue",
    },
    {
        "symbol": "META",
        "rule": "off_high",
        "threshold": 10,
        "note": "Massive AI capex + ad-business cash flow",
    },
    {
        "symbol": "AVGO",
        "rule": "below_sma",
        "threshold": 50,
        "note": "Custom ASICs (Google TPU, Meta MTIA) + networking",
    },
    {
        "symbol": "MU",
        "rule": "off_high",
        "threshold": 20,
        "note": "HBM bottleneck — cyclical, deeper dips",
    },
    {
        "symbol": "CEG",
        "rule": "off_high",
        "threshold": 15,
        "note": "Nuclear PPAs to hyperscalers",
    },
    {
        "symbol": "VRT",
        "rule": "off_high",
        "threshold": 20,
        "note": "Liquid cooling for AI racks",
    },
    {
        "symbol": "TSM",
        "rule": "rsi",
        "threshold": 35,
        "note": "Foundry monopoly — mean-revert on oversold RSI",
    },
    {
        "symbol": "CRWV",
        "rule": "off_high",
        "threshold": 25,
        "note": "Pure AI hyperscaler IPO — moonshot",
    },
    {
        "symbol": "OKLO",
        "rule": "off_high",
        "threshold": 30,
        "note": "SMR nuclear pre-revenue — lottery",
    },
]


@router.post("/seed-defaults")
def seed_defaults(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Bulk-add the curated AI-cycle buy watch (10 names spanning all stack
    layers). Skips any ticker already on the watch — safe to call repeatedly."""
    _require_owner(request)
    existing = {r.symbol.upper() for r in db.query(BuyTarget).all()}
    next_order = db.query(BuyTarget).order_by(BuyTarget.sort_order.desc()).first()
    base_order = (next_order.sort_order + 1) if next_order else 0

    added: list[str] = []
    for i, defn in enumerate(SEED_DEFAULTS):
        sym = defn["symbol"].upper()
        if sym in existing:
            continue
        db.add(
            BuyTarget(
                symbol=sym,
                rule=defn["rule"],
                target_price=defn.get("target_price"),
                threshold=defn.get("threshold"),
                note=defn.get("note"),
                sort_order=base_order + i,
            )
        )
        added.append(sym)
    db.commit()
    return {
        "added": added,
        "skipped_existing": [s["symbol"] for s in SEED_DEFAULTS if s["symbol"] in existing],
    }
