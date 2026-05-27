"""Resolve which SPY option contract to trade for a given signal.

Strategy: shortest-DTE ATM that's NOT same-day. Skips today's expiration if
it exists in the chain and picks the next available expiration instead — so
the trade has ~1 day of time premium at entry (avoids the 0-DTE gamma cliff
that crushes positions when SPY barely moves during the day).
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


async def pick_next_day_atm(spot: float, side: str) -> tuple[str, float, str] | None:
    """Return (occ_symbol, strike, expiration) for the next-day ATM SPY
    call/put — the shortest-DTE expiration that is NOT today.

    Returns None if no future expiration is available (weekend with no
    next-week expiration loaded, etc.).

    `side` = 'call' | 'put'.
    """
    today = datetime.utcnow().strftime("%Y-%m-%d")
    try:
        exps = await yahoo.expirations(UNDERLYING)
    except Exception:
        return None
    if not exps:
        return None

    # yahoo returns sorted ascending. Pick the first expiration strictly
    # AFTER today. If today itself appears in the list, skip it.
    target_exp: str | None = None
    for exp in exps:
        if exp > today:
            target_exp = exp
            break
    if target_exp is None:
        return None

    try:
        chain = await yahoo.option_chain(UNDERLYING, target_exp)
    except Exception:
        return None

    rows = chain.get("calls" if side.lower().startswith("c") else "puts", [])
    if not rows:
        return None
    strikes = [float(r["strike"]) for r in rows if r.get("strike")]
    if not strikes:
        return None
    atm_strike = min(strikes, key=lambda k: abs(k - spot))
    occ = _occ_symbol(UNDERLYING, target_exp, side, atm_strike)
    return occ, atm_strike, target_exp


# Back-compat alias — callers import `pick_0dte_atm` from older code.
# Points to the new "next-day" behaviour. Remove once all call sites are
# updated.
pick_0dte_atm = pick_next_day_atm
