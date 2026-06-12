"""Bot runner — ticks every 60s while running, scans for divergence on SPY
5m bars, places paper orders, monitors open positions.

State lives in the DB (BotState row), so a Render free-tier restart resumes
the bot in whatever state it was last in (running or paused). The bot is
*opt-in*: BotState defaults to running=False on first creation.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from sqlalchemy import desc, select

from ...db import SessionLocal
from ...models import BotSignal, BotState, BotTrade
from .. import alpaca
from . import safety
from .contract import pick_next_day_atm
from .detector import Bar, detect
from .monitor import close_trade_if_target_hit
from .sizing import size_for_risk

log = logging.getLogger("bot.runner")

TICK_INTERVAL_SEC = 60
# Need this many 5m bars before the detector can produce anything useful
# (RSI burns the first 14 + we need lookback room for swings).
MIN_BARS = 50
# Hard ceiling on entries per UTC day. The daily loss cap only trips after
# losses accumulate; on a whipsaw day the detector can keep firing fresh
# signals between stop-outs, re-entering until the loss cap finally bites.
# This caps the bleed regardless of P/L.
MAX_TRADES_PER_DAY = 3
# When the latest signal index is the same as last tick's, skip placing
# another order — keeps a stale signal from re-firing every minute.
_last_signal_key: tuple[str, int] | None = None


def _get_or_create_state() -> BotState:
    db = SessionLocal()
    try:
        state = db.scalar(select(BotState).where(BotState.id == 1))
        if state is None:
            state = BotState(id=1, running=False)
            db.add(state)
            db.commit()
        return state
    finally:
        db.close()


def _today_utc() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d")


async def _fetch_5m_bars(symbol: str = "SPY") -> list[Bar]:
    """Pull the most recent 5m bars from Alpaca. We ask for ~1000 bars
    (≈12 trading days) which is comfortably above MIN_BARS even on a slow
    morning. Returns oldest-first."""
    try:
        raw = await alpaca.bars(symbol, timeframe="5Min", limit=1000)
    except Exception as e:
        log.warning("bars fetch failed: %s", e)
        return []
    return [
        Bar(open=float(b["o"]), high=float(b["h"]), low=float(b["l"]), close=float(b["c"]))
        for b in raw
    ]


async def _equity() -> float:
    try:
        acct = await alpaca.get_account()
        # Paper accounts return both `equity` and `portfolio_value`; either
        # works as our risk denominator.
        v = acct.get("equity") or acct.get("portfolio_value") or 0
        return float(v)
    except Exception as e:
        log.warning("equity fetch failed: %s", e)
        return 0.0


async def _option_mark(occ_symbol: str) -> float | None:
    snaps = await alpaca.option_snapshots([occ_symbol])
    snap = snaps.get(occ_symbol) or {}
    q = snap.get("latestQuote") or {}
    bid, ask = float(q.get("bp") or 0), float(q.get("ap") or 0)
    if bid > 0 and ask > 0:
        return (bid + ask) / 2.0
    t = snap.get("latestTrade") or {}
    p = float(t.get("p") or 0)
    return p if p > 0 else None


async def _try_open_trade(spot: float, side: str, signal_id: int) -> BotTrade | None:
    """Resolve contract → size → place paper buy → persist trade row."""
    picked = await pick_next_day_atm(spot, side)
    if picked is None:
        log.info("no next-day expiration available for SPY; skipping")
        return None
    occ, strike, expiration = picked
    mark = await _option_mark(occ)
    if mark is None or mark <= 0.05:
        log.info("no usable mark for %s; skipping", occ)
        return None
    equity = await _equity()
    qty = size_for_risk(equity=equity, entry_mark=mark)
    if qty <= 0:
        log.info("sizing returned 0 contracts (equity=%s, mark=%s)", equity, mark)
        return None
    # Limit price: 5% above mid to improve fill probability without
    # overpaying on a wide spread.
    limit = round(mark * 1.05, 2)
    try:
        order = await alpaca.submit_order(
            {
                "symbol": occ,
                "qty": qty,
                "side": "buy",
                "type": "limit",
                "time_in_force": "day",
                "limit_price": str(limit),
            }
        )
    except Exception as e:
        log.warning("entry order failed for %s: %s", occ, e)
        return None
    db = SessionLocal()
    try:
        trade = BotTrade(
            signal_id=signal_id,
            occ_symbol=occ,
            side=side,
            qty=qty,
            entry_price=mark,
            entry_order_id=order.get("id"),
            tp_price=round(mark * 1.20, 4),
            sl_price=round(mark * 0.80, 4),
        )
        db.add(trade)
        db.commit()
        db.refresh(trade)
        # Backfill the signal with the trade id.
        sig = db.get(BotSignal, signal_id)
        if sig is not None:
            sig.trade_id = trade.id
            db.commit()
        return trade
    finally:
        db.close()


async def _tick() -> None:
    """Single tick of the bot loop. Catches all exceptions so a transient
    error never crashes the loop."""
    global _last_signal_key
    try:
        state = _get_or_create_state()
        if not state.running:
            return
        if not safety.is_paper():
            log.error("ALPACA_BASE_URL is not paper — auto-disabling bot")
            db = SessionLocal()
            try:
                s = db.get(BotState, 1)
                if s is not None:
                    s.running = False
                    db.commit()
            finally:
                db.close()
            return

        # 1. Update tick + reset daily counters if rolled into a new day.
        db = SessionLocal()
        try:
            s = db.get(BotState, 1)
            if s is None:
                return
            s.last_tick = datetime.utcnow()
            today = _today_utc()
            if s.day_date != today:
                s.day_date = today
                s.day_pnl = 0.0
                s.daily_loss_cap_hit = False
            db.commit()
            daily_loss_cap_hit = bool(s.daily_loss_cap_hit)
        finally:
            db.close()

        # 2. Monitor any open trades (TP/SL/time-stop) regardless of cap.
        await _monitor_open_trades()

        # 3. If the daily loss cap is hit OR we're outside the entry window,
        # we don't open new trades but keep monitoring.
        if daily_loss_cap_hit or not safety.is_within_entry_window():
            return

        # 4. Pull bars + run detector.
        bars = await _fetch_5m_bars()
        if len(bars) < MIN_BARS:
            return
        signal = detect(bars)
        if signal is None:
            return
        # Dedupe: a divergence at bar index N keeps firing on subsequent
        # ticks until a new bar arrives. Skip if we already acted on it.
        key = ("SPY", signal.index)
        if _last_signal_key == key:
            return
        _last_signal_key = key

        spot = bars[-1].close
        # Always log the signal, even if we don't trade it.
        db = SessionLocal()
        try:
            row = BotSignal(
                side=signal.side,
                spot=spot,
                prior_extreme_price=signal.prior_extreme_price,
                current_extreme_price=signal.current_extreme_price,
                prior_extreme_rsi=signal.prior_extreme_rsi,
                current_extreme_rsi=signal.current_extreme_rsi,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            signal_id = row.id
        finally:
            db.close()

        # 5. Don't stack positions — if we have an open trade, log + skip.
        if await _has_open_trade():
            db = SessionLocal()
            try:
                sig = db.get(BotSignal, signal_id)
                if sig is not None:
                    sig.skip_reason = "open_position"
                    db.commit()
            finally:
                db.close()
            return

        # 5b. Per-day entry ceiling, independent of P/L.
        if _trades_opened_today() >= MAX_TRADES_PER_DAY:
            db = SessionLocal()
            try:
                sig = db.get(BotSignal, signal_id)
                if sig is not None:
                    sig.skip_reason = "max_trades_per_day"
                    db.commit()
            finally:
                db.close()
            return

        # 6. Open a new trade.
        trade = await _try_open_trade(spot, signal.side, signal_id)
        if trade is None:
            db = SessionLocal()
            try:
                sig = db.get(BotSignal, signal_id)
                if sig is not None:
                    sig.skip_reason = "open_failed"
                    db.commit()
            finally:
                db.close()
    except Exception:
        log.exception("bot tick failed")


async def _has_open_trade() -> bool:
    db = SessionLocal()
    try:
        row = db.scalar(
            select(BotTrade).where(BotTrade.exit_at.is_(None)).order_by(desc(BotTrade.id)).limit(1)
        )
        return row is not None
    finally:
        db.close()


def _trades_opened_today() -> int:
    """Entries with entry_at on the current UTC date — drives MAX_TRADES_PER_DAY."""
    db = SessionLocal()
    try:
        midnight = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        rows = db.execute(select(BotTrade).where(BotTrade.entry_at >= midnight)).scalars().all()
        return len(rows)
    finally:
        db.close()


async def _monitor_open_trades() -> None:
    db = SessionLocal()
    try:
        rows = db.execute(select(BotTrade).where(BotTrade.exit_at.is_(None))).scalars().all()
    finally:
        db.close()
    for trade in rows:
        try:
            await close_trade_if_target_hit(trade)
        except Exception:
            log.exception("monitor failed for trade %s", trade.id)


async def loop() -> None:
    """The forever-loop. Started in `lifespan`. Cancellation-safe."""
    log.info("bot loop starting (interval=%ss)", TICK_INTERVAL_SEC)
    try:
        while True:
            await _tick()
            await asyncio.sleep(TICK_INTERVAL_SEC)
    except asyncio.CancelledError:
        log.info("bot loop cancelled")
        raise
