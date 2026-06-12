from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import IVHistory
from ..services import alpaca, yahoo
from ..services.blackscholes import greeks
from ..services.errors import provider_error
from ..services.indicators import iv_percentile, iv_rank

router = APIRouter(prefix="/options", tags=["options"])


def _atm_strike(strikes: list[float], spot: float) -> float | None:
    if not strikes or spot <= 0:
        return None
    return min(strikes, key=lambda k: abs(k - spot))


async def _spot_price(symbol: str) -> float:
    trades = await alpaca.latest_trades([symbol])
    t = trades.get(symbol, {})
    return float(t.get("p", 0.0))


def _save_iv_snapshot(db: Session, symbol: str, atm_iv: float) -> None:
    today = datetime.utcnow().strftime("%Y-%m-%d")
    existing = (
        db.query(IVHistory)
        .filter(IVHistory.symbol == symbol, IVHistory.as_of_date == today)
        .first()
    )
    if existing:
        return
    db.add(IVHistory(symbol=symbol, as_of_date=today, atm_iv=atm_iv))
    db.commit()


def _iv_history(db: Session, symbol: str) -> list[float]:
    rows = (
        db.query(IVHistory).filter(IVHistory.symbol == symbol).order_by(IVHistory.as_of_date).all()
    )
    return [r.atm_iv for r in rows]


@router.get("/{symbol}/expirations")
async def list_expirations(symbol: str) -> dict[str, Any]:
    sym = symbol.upper()
    try:
        exps = await yahoo.expirations(sym)
    except Exception as e:
        raise HTTPException(status_code=502, detail=provider_error("Yahoo", e)) from e
    return {"symbol": sym, "expirations": exps}


@router.get("/{symbol}/iv")
async def iv_summary(symbol: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    sym = symbol.upper()
    try:
        spot = await _spot_price(sym)
        exps = await yahoo.expirations(sym)
    except Exception as e:
        raise HTTPException(status_code=502, detail=provider_error("Market data", e)) from e

    if not exps:
        return {
            "symbol": sym,
            "atm_iv": None,
            "iv_rank": None,
            "iv_percentile": None,
            "history_days": 0,
            "term_structure": [],
            "skew": [],
            "spot": spot,
            "warning": (
                "Yahoo Finance returned no option expirations for this ticker. "
                "Either the symbol has no listed options, or yfinance is being "
                "rate-limited from the server's IP."
            ),
        }

    # Term structure: ATM IV across expirations.
    term: list[dict[str, Any]] = []
    nearest_chain: dict[str, list[dict[str, Any]]] | None = None
    for exp in exps[:8]:
        try:
            chain = await yahoo.option_chain(sym, exp)
        except Exception:
            continue
        calls = chain.get("calls", [])
        if not calls:
            continue
        strikes = [float(c["strike"]) for c in calls if c.get("strike")]
        atm = _atm_strike(strikes, spot)
        if atm is None:
            continue
        atm_call = next((c for c in calls if float(c["strike"]) == atm), None)
        if not atm_call:
            continue
        iv = atm_call.get("impliedVolatility")
        if iv is None:
            continue
        term.append({"expiration": exp, "atm_iv": float(iv), "atm_strike": atm})
        if nearest_chain is None:
            nearest_chain = chain

    front_atm_iv = term[0]["atm_iv"] if term else None

    if front_atm_iv is not None:
        try:
            _save_iv_snapshot(db, sym, front_atm_iv)
        except Exception:
            db.rollback()

    history = _iv_history(db, sym)
    iv_r = iv_rank(front_atm_iv, history) if front_atm_iv is not None else None
    iv_p = iv_percentile(front_atm_iv, history) if front_atm_iv is not None else None

    # Skew: IV across strikes in the nearest expiration (calls + puts at each strike → midpoint IV).
    skew: list[dict[str, Any]] = []
    if nearest_chain:
        calls_by_strike = {float(c["strike"]): c for c in nearest_chain["calls"]}
        puts_by_strike = {float(p["strike"]): p for p in nearest_chain["puts"]}
        all_strikes = sorted(set(calls_by_strike) | set(puts_by_strike))
        for s in all_strikes:
            c_iv = calls_by_strike.get(s, {}).get("impliedVolatility")
            p_iv = puts_by_strike.get(s, {}).get("impliedVolatility")
            ivs = [v for v in (c_iv, p_iv) if v]
            if not ivs:
                continue
            skew.append({"strike": s, "iv": sum(ivs) / len(ivs)})

    return {
        "symbol": sym,
        "spot": spot,
        "atm_iv": front_atm_iv,
        "iv_rank": iv_r,
        "iv_percentile": iv_p,
        "history_days": len(history),
        "term_structure": term,
        "skew": skew,
        "warning": (
            None if term else "Yahoo returned no IV data for any expiration (likely rate-limited)."
        ),
    }


def _enrich_row(
    row: dict[str, Any], spot: float, days_to_exp: float, is_call: bool
) -> dict[str, Any]:
    iv = row.get("impliedVolatility") or 0.0
    g = greeks(
        spot=spot, strike=float(row["strike"]), iv=iv, days_to_exp=days_to_exp, is_call=is_call
    )
    bid = row.get("bid") or 0.0
    ask = row.get("ask") or 0.0
    mid = (bid + ask) / 2.0 if bid and ask else None
    spread_pct = ((ask - bid) / mid * 100.0) if mid and mid > 0 else None
    vol = row.get("volume") or 0
    oi = row.get("openInterest") or 0
    return {
        "strike": float(row["strike"]),
        "bid": bid,
        "ask": ask,
        "last": row.get("lastPrice"),
        "volume": vol,
        "open_interest": oi,
        "iv": iv,
        "delta": g["delta"] if g else None,
        "gamma": g["gamma"] if g else None,
        "theta": g["theta"] if g else None,
        "vega": g["vega"] if g else None,
        "spread_pct": spread_pct,
        "unusual_volume": vol > 0 and oi > 0 and vol > oi,
        "in_the_money": bool(row.get("inTheMoney")),
    }


@router.get("/{symbol}/chain")
async def chain(
    symbol: str,
    expiration: str = Query(..., description="YYYY-MM-DD"),
) -> dict[str, Any]:
    sym = symbol.upper()
    try:
        spot = await _spot_price(sym)
        chain_data = await yahoo.option_chain(sym, expiration)
    except Exception as e:
        raise HTTPException(status_code=502, detail=provider_error("Market data", e)) from e

    try:
        exp_dt = datetime.strptime(expiration, "%Y-%m-%d")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    days_to_exp = max(1.0, (exp_dt - datetime.utcnow()).total_seconds() / 86400.0)

    calls = [_enrich_row(r, spot, days_to_exp, True) for r in chain_data.get("calls", [])]
    puts = [_enrich_row(r, spot, days_to_exp, False) for r in chain_data.get("puts", [])]

    return {
        "symbol": sym,
        "expiration": expiration,
        "spot": spot,
        "days_to_exp": days_to_exp,
        "calls": calls,
        "puts": puts,
    }


@router.get("/snapshot")
async def option_snapshot(occ: str) -> dict[str, Any]:
    """Live Alpaca bid/ask/last for a single OCC option symbol. Lets the
    frontend back-solve a real-time IV via Black-Scholes instead of relying
    on yfinance's possibly-delayed chain IV.

    Returns {bid, ask, mid, last} — all floats; null when Alpaca has no
    quote for the symbol (illiquid strike, malformed OCC, etc.).
    """
    occ = (occ or "").strip().upper()
    if not occ:
        raise HTTPException(status_code=400, detail="occ is required")
    snaps = await alpaca.option_snapshots([occ])
    snap = snaps.get(occ) or {}
    q = snap.get("latestQuote") or {}
    t = snap.get("latestTrade") or {}
    bid = float(q.get("bp") or 0) or None
    ask = float(q.get("ap") or 0) or None
    mid = (bid + ask) / 2.0 if (bid and ask) else None
    last = float(t.get("p") or 0) or None
    return {"occ": occ, "bid": bid, "ask": ask, "mid": mid, "last": last}
