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

VALID_RULES = {"price", "off_high", "below_sma", "rsi", "smart"}


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


def _smart_score(
    last: float,
    high_52w: float | None,
    sma50: float | None,
    sma200: float | None,
    rsi_val: float | None,
) -> tuple[float, dict[str, float]]:
    """Multi-factor buy score, 0-100. Higher = more bullish entry signal.
    Returns (total, components) for UI breakdown.

    The factors:
      - Drawdown from 52w high (35 pts max) — bigger pullback = better entry
      - Pullback to 50DMA (25 pts max)      — classic buy-the-dip support
      - RSI oversold (20 pts max)           — mean-reversion signal
      - Trend intact above 200DMA (10 pts)  — don't bottom-fish downtrends
      - Confluence bonus (10 pts)           — multiple signals aligned
    """
    components: dict[str, float] = {
        "drawdown": 0,
        "sma50_pullback": 0,
        "rsi_oversold": 0,
        "trend_intact": 0,
        "confluence": 0,
    }
    if last <= 0:
        return (0.0, components)

    # 1. Drawdown from 52w high (max 35 pts; 23%+ off high = full points)
    off_high_pct = 0.0
    if high_52w and high_52w > 0:
        off_high_pct = max(0.0, (high_52w - last) / high_52w * 100.0)
        components["drawdown"] = min(35.0, off_high_pct * 1.5)

    # 2. Pullback to 50DMA (max 25 pts)
    if sma50 and sma50 > 0:
        if last <= sma50:
            pct_below = (sma50 - last) / sma50 * 100.0
            components["sma50_pullback"] = min(25.0, 15.0 + pct_below * 2.0)
        elif last <= sma50 * 1.05:
            components["sma50_pullback"] = 10.0

    # 3. RSI oversold (max 20 pts)
    if rsi_val is not None:
        if rsi_val <= 30:
            components["rsi_oversold"] = 20.0
        elif rsi_val <= 40:
            components["rsi_oversold"] = 15.0
        elif rsi_val <= 50:
            components["rsi_oversold"] = 8.0

    # 4. Trend intact (max 10 pts; reward staying above the 200DMA)
    if sma200 and sma200 > 0 and last >= sma200:
        components["trend_intact"] = 10.0

    # 5. Confluence — bonus when multiple signals agree (max 10 pts)
    signals_active = sum(
        [
            off_high_pct >= 10,
            bool(sma50 and last <= sma50 * 1.02),
            bool(rsi_val is not None and rsi_val <= 40),
        ]
    )
    if signals_active >= 2:
        components["confluence"] = 10.0
    elif signals_active >= 1:
        components["confluence"] = 5.0

    total = sum(components.values())
    return (total, components)


def _compute_status(
    last: float,
    trigger: float | None,
    rule: str,
    rsi_val: float | None,
    threshold: float | None,
    smart_score: float | None = None,
) -> tuple[str, float | None]:
    """Returns (status, distance_pct). Distance is signed: positive means
    price is ABOVE the trigger (still need to wait), negative means in zone."""
    if rule == "smart":
        # Smart rule: status based on composite score vs threshold.
        # `distance` here is (score - threshold) — positive = past trigger
        # (in zone), negative = below.
        if smart_score is None or threshold is None:
            return ("unknown", None)
        diff = smart_score - threshold
        if diff >= 0:
            return ("in_zone", diff)
        if diff >= -10:
            return ("near", diff)
        return ("far", diff)
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


def _enrich_one(
    symbol: str,
    rule: str,
    target_price: float | None,
    threshold: float | None,
    bars_for_symbol: list[dict[str, Any]],
    trade: dict[str, Any],
    *,
    target_id: int | None = None,
    note: str | None = None,
    sort_order: int = 0,
) -> dict[str, Any]:
    """Compute the full enriched target row (last, SMAs, RSI, trigger, status,
    smart score) for a single ticker. Pure-ish: takes pre-fetched bars and
    trade payloads, no I/O. Used by both /buy-watch and /theme-watch."""
    sym = symbol.upper()
    last = float(trade.get("p") or 0) or (
        float(bars_for_symbol[-1].get("c") or 0) if bars_for_symbol else 0.0
    )
    closes = [float(b.get("c") or 0) for b in bars_for_symbol if b.get("c")]
    high_52w = max(closes[-252:]) if len(closes) >= 1 else None
    low_52w = min(closes[-252:]) if len(closes) >= 1 else None
    sma20 = sum(closes[-20:]) / 20 if len(closes) >= 20 else None
    sma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else None
    sma200 = sum(closes[-200:]) / 200 if len(closes) >= 200 else None
    rsi_val = rsi(closes, 14)[-1] if len(closes) >= 15 else None
    trigger = _trigger_price(rule, target_price, threshold, high_52w, sma20, sma50, sma200)
    smart_score, smart_components = _smart_score(last, high_52w, sma50, sma200, rsi_val)
    status, distance = _compute_status(
        last, trigger, rule, rsi_val, threshold, smart_score=smart_score
    )
    off_high_pct = ((last - high_52w) / high_52w * 100.0) if (high_52w and last) else None
    return {
        "id": target_id,
        "symbol": sym,
        "rule": rule,
        "target_price": target_price,
        "threshold": threshold,
        "note": note,
        "sort_order": sort_order,
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
        "smart_score": round(smart_score, 1),
        "smart_components": {k: round(v, 1) for k, v in smart_components.items()},
    }


_STATUS_ORDER = {"in_zone": 0, "near": 1, "far": 2, "unknown": 3}


async def _enrich_targets(targets: list[BuyTarget]) -> list[dict[str, Any]]:
    """Fetch bars + latest trades for all symbols at once, then enrich each
    target. Sorted: in_zone first, then near, then far."""
    if not targets:
        return []
    symbols = sorted({t.symbol.upper() for t in targets})
    try:
        trades = await alpaca.latest_trades(symbols)
        bars = await alpaca.daily_bars(symbols, days=280)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e
    out: list[dict[str, Any]] = []
    for t in targets:
        sym = t.symbol.upper()
        out.append(
            _enrich_one(
                sym,
                t.rule,
                t.target_price,
                t.threshold,
                bars.get(sym) or [],
                trades.get(sym, {}),
                target_id=t.id,
                note=t.note,
                sort_order=t.sort_order,
            )
        )
    out.sort(key=lambda x: (_STATUS_ORDER.get(x["status"], 3), x.get("distance_pct") or 0))
    return out


@router.get("")
async def list_targets(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Returns all buy targets enriched with current price, computed signals
    (52w high, SMAs, RSI), trigger price, and status."""
    rows = (
        db.query(BuyTarget).order_by(BuyTarget.sort_order.asc(), BuyTarget.created_at.asc()).all()
    )
    if not rows:
        return {"targets": []}
    return {"targets": await _enrich_targets(rows)}


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
# Smart-rule thresholds:
#   80 = very conservative (multiple strong signals required)
#   70 = balanced (default)
#   60 = aggressive (early entry on volatile names where pullbacks come fast)
SEED_DEFAULTS: list[dict[str, Any]] = [
    {"symbol": "NVDA", "rule": "smart", "threshold": 70, "note": "Compute backbone — AI #1"},
    {"symbol": "MSFT", "rule": "smart", "threshold": 70, "note": "Hyperscaler, real AI revenue"},
    {"symbol": "META", "rule": "smart", "threshold": 70, "note": "AI capex + ad cash flow"},
    {"symbol": "AVGO", "rule": "smart", "threshold": 70, "note": "Custom ASICs + networking"},
    {"symbol": "MU", "rule": "smart", "threshold": 65, "note": "HBM memory — more cyclical"},
    {"symbol": "CEG", "rule": "smart", "threshold": 70, "note": "Nuclear PPAs to hyperscalers"},
    {"symbol": "VRT", "rule": "smart", "threshold": 70, "note": "Liquid cooling for AI racks"},
    {"symbol": "TSM", "rule": "smart", "threshold": 70, "note": "Foundry monopoly"},
    {"symbol": "CRWV", "rule": "smart", "threshold": 60, "note": "Pure-play AI IPO — moonshot"},
    {"symbol": "OKLO", "rule": "smart", "threshold": 60, "note": "SMR nuclear lottery"},
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
