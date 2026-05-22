"""Risk-based position sizing for the bot.

`-2% of equity per trade` means: the stop-loss (-20% on option mark) should
take you out at no more than 2% of account equity lost.

  loss_per_contract_at_stop = entry_mark × 100 × stop_pct
  qty = floor((risk_pct × equity) / loss_per_contract_at_stop)

Floored at 1 (otherwise we'd never trade), capped at MAX_QTY so a busted
account-equity fetch or a $0.01 option can't size into the moon.
"""

from __future__ import annotations

import math

# Hard cap regardless of risk math — prevents a misreported equity number
# (or a sub-pennystock-priced option) from sizing into a runaway position.
MAX_QTY = 20


def size_for_risk(
    *,
    equity: float,
    entry_mark: float,
    stop_pct: float = 0.20,
    risk_pct: float = 0.02,
) -> int:
    """Number of contracts to buy. Returns 0 if math is undefined (bad input)."""
    if equity <= 0 or entry_mark <= 0 or stop_pct <= 0 or risk_pct <= 0:
        return 0
    loss_per_contract = entry_mark * 100.0 * stop_pct
    if loss_per_contract <= 0:
        return 0
    raw = (risk_pct * equity) / loss_per_contract
    qty = max(1, int(math.floor(raw)))
    return min(qty, MAX_QTY)
