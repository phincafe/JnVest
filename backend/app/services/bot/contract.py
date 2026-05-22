"""Resolve which SPY option contract to trade for a given signal.

Strategy: 0-DTE ATM. If today isn't a SPY expiration (weekend, holiday, or
a rare gap day), fall back to the nearest available expiration.
"""

from __future__ import annotations

from datetime import datetime

from .. import yahoo

UNDERLYING = "SPY"


def _occ_symbol(underlying: str, expiration: str, side: str, strike: float) -> str:
    """OCC option symbol. Same format Alpaca's options endpoints expect.
    Mirrors backend/app/routers/snaptrade.py:_to_occ_symbol but standalone
    so the bot module doesn't pull in router imports."""
    yy = expiration[2:4]
    mm = expiration[5:7]
    dd = expiration[8:10]
    cp = "C" if side.lower().startswith("c") else "P"
    strike_int = int(round(strike * 1000))
    return f"{underlying.upper()}{yy}{mm}{dd}{cp}{strike_int:08d}"


async def pick_0dte_atm(spot: float, side: str) -> tuple[str, float, str] | None:
    """Return (occ_symbol, strike, expiration) for today's ATM SPY call/put.
    Returns None if no expiration is available today (weekend / holiday).

    `side` = 'call' | 'put'.
    """
    today = datetime.utcnow().strftime("%Y-%m-%d")
    try:
        exps = await yahoo.expirations(UNDERLYING)
    except Exception:
        return None
    if not exps:
        return None

    # Prefer today's expiration; else the nearest future one.
    target_exp = today if today in exps else exps[0]

    try:
        chain = await yahoo.option_chain(UNDERLYING, target_exp)
    except Exception:
        return None

    rows = chain.get("calls" if side.lower().startswith("c") else "puts", [])
    if not rows:
        return None
    # ATM = strike closest to spot. Ignore strikes with zero strike (junk).
    strikes = [float(r["strike"]) for r in rows if r.get("strike")]
    if not strikes:
        return None
    atm_strike = min(strikes, key=lambda k: abs(k - spot))
    occ = _occ_symbol(UNDERLYING, target_exp, side, atm_strike)
    return occ, atm_strike, target_exp
