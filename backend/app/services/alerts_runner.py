"""Price-alert background evaluator.

Polls Alpaca latest_trades for all symbols with un-triggered alerts every
60s. When the last trade crosses an alert's threshold, sets triggered_at
+ triggered_price so the frontend can pop a browser notification on its
next status poll.

Started in app lifespan alongside the bot runner. Cheap to leave running —
when there are no active alerts the tick is a no-op DB query.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from sqlalchemy import select

from ..db import SessionLocal
from ..models import PriceAlert
from . import alpaca

log = logging.getLogger("alerts.runner")

TICK_INTERVAL_SEC = 60

# Timestamp of the most recent completed tick. Surfaced via /api/alerts so
# the UI can warn when evaluation has stalled — on Render's free tier the
# instance sleeps after 15 min idle and alerts silently stop evaluating.
last_evaluated_at: datetime | None = None


def _crossed(direction: str, threshold: float, last_price: float) -> bool:
    if direction == "above":
        return last_price >= threshold
    if direction == "below":
        return last_price <= threshold
    return False


async def _tick() -> None:
    """Single tick — query active alerts, fetch quotes, mark triggers."""
    global last_evaluated_at
    try:
        db = SessionLocal()
        try:
            active = (
                db.execute(select(PriceAlert).where(PriceAlert.triggered_at.is_(None)))
                .scalars()
                .all()
            )
        finally:
            db.close()
        last_evaluated_at = datetime.utcnow()
        if not active:
            return
        symbols = sorted({a.symbol.upper() for a in active})
        try:
            trades = await alpaca.latest_trades(symbols)
        except Exception as e:
            log.warning("latest_trades failed: %s", e)
            return
        now = datetime.utcnow()
        # Re-open the session for writes; we only update rows whose price
        # actually crossed, so this is cheap even with many alerts.
        db = SessionLocal()
        try:
            for a in active:
                trade = trades.get(a.symbol.upper(), {})
                last = float(trade.get("p") or 0)
                if last <= 0:
                    continue
                if _crossed(a.direction, a.threshold, last):
                    fresh = db.get(PriceAlert, a.id)
                    if fresh is None or fresh.triggered_at is not None:
                        continue
                    fresh.triggered_at = now
                    fresh.triggered_price = last
                    log.info(
                        "alert %s triggered: %s %s %s @ %s",
                        a.id,
                        a.symbol,
                        a.direction,
                        a.threshold,
                        last,
                    )
            db.commit()
        finally:
            db.close()
    except Exception:
        log.exception("alerts tick failed")


async def loop() -> None:
    """Forever-loop. Started in app lifespan. Cancellation-safe."""
    log.info("alerts loop starting (interval=%ss)", TICK_INTERVAL_SEC)
    try:
        while True:
            await _tick()
            await asyncio.sleep(TICK_INTERVAL_SEC)
    except asyncio.CancelledError:
        log.info("alerts loop cancelled")
        raise
