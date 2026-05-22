"""Per-position exit monitor.

For each open BotTrade, on every bot tick:
  1. Fetch the option's latest mark from Alpaca
  2. If mark >= tp_price → place sell at limit, mark closed (reason=tp)
  3. If mark <= sl_price → place sell at market, mark closed (reason=sl)
  4. If past 15:30 ET → place sell at market, mark closed (reason=time)

The realized P/L written to the row uses the actual `exit_price` returned
from the option mark at close time (not the limit fill price), so the
cumulative day_pnl on BotState reflects what we expected to get — refined
on the next tick once the broker reports the actual fill price.
"""

from __future__ import annotations

import logging
from datetime import datetime

from ...db import SessionLocal
from ...models import BotState, BotTrade
from .. import alpaca
from . import safety

log = logging.getLogger("bot.monitor")


async def _option_mark(occ: str) -> float | None:
    snaps = await alpaca.option_snapshots([occ])
    snap = snaps.get(occ) or {}
    q = snap.get("latestQuote") or {}
    bid, ask = float(q.get("bp") or 0), float(q.get("ap") or 0)
    if bid > 0 and ask > 0:
        return (bid + ask) / 2.0
    t = snap.get("latestTrade") or {}
    p = float(t.get("p") or 0)
    return p if p > 0 else None


async def close_trade_if_target_hit(trade: BotTrade) -> bool:
    """Returns True if we closed the trade this call, else False."""
    mark = await _option_mark(trade.occ_symbol)
    now = datetime.utcnow()
    reason: str | None = None
    if mark is not None:
        if mark >= trade.tp_price:
            reason = "tp"
        elif mark <= trade.sl_price:
            reason = "sl"
    if reason is None and safety.is_past_time_stop(now):
        reason = "time"
    if reason is None:
        return False

    # Limit at 5% below mark for sells = same +5% headroom as entry, but
    # on the other side. For market-on-time-stop / SL we don't care about
    # slippage — get out.
    order_type = "limit" if reason == "tp" else "market"
    payload: dict = {
        "symbol": trade.occ_symbol,
        "qty": trade.qty,
        "side": "sell",
        "type": order_type,
        "time_in_force": "day",
    }
    if order_type == "limit" and mark is not None:
        payload["limit_price"] = str(round(mark * 0.95, 2))
    try:
        order = await alpaca.submit_order(payload)
    except Exception as e:
        log.warning("close order failed for %s: %s", trade.occ_symbol, e)
        return False

    exit_mark = mark if mark is not None else trade.sl_price
    realized = (exit_mark - trade.entry_price) * 100.0 * trade.qty

    db = SessionLocal()
    try:
        row = db.get(BotTrade, trade.id)
        if row is None:
            return False
        row.exit_at = now
        row.exit_price = exit_mark
        row.exit_reason = reason
        row.exit_order_id = order.get("id")
        row.realized_pnl = realized
        # Roll the day_pnl on BotState.
        state = db.get(BotState, 1)
        if state is not None:
            today = now.strftime("%Y-%m-%d")
            if state.day_date != today:
                state.day_date = today
                state.day_pnl = 0.0
                state.daily_loss_cap_hit = False
            state.day_pnl = (state.day_pnl or 0.0) + realized
            # Check daily loss cap.
            try:
                acct = await alpaca.get_account()
                equity = float(acct.get("equity") or acct.get("portfolio_value") or 0)
                if equity > 0 and state.day_pnl <= -equity * safety.DAILY_LOSS_CAP_PCT:
                    state.daily_loss_cap_hit = True
                    log.warning(
                        "daily loss cap hit (day_pnl=%s, equity=%s); pausing new entries",
                        state.day_pnl,
                        equity,
                    )
            except Exception:
                pass
        db.commit()
    finally:
        db.close()
    log.info("closed trade %s reason=%s pnl=%s", trade.id, reason, realized)
    return True
