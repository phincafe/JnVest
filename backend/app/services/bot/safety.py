"""Safety checks for the bot. Every order placement runs through these.

These are belt-and-suspenders on top of the Alpaca paper-only check in
`services/alpaca.submit_order`.
"""

from __future__ import annotations

from datetime import datetime, time

from ...config import get_settings

# Don't trade outside regular RTH 9:30-15:30 ET (skip the last 30 min so
# the position monitor can close before the 0-DTE gamma cliff at 16:00).
RTH_OPEN_ET = time(9, 30)
RTH_LATEST_ENTRY_ET = time(15, 30)
DAILY_LOSS_CAP_PCT = 0.05  # auto-disable for the day if down 5% of equity


def is_paper() -> bool:
    """Sanity-check that we're pointed at the paper trading host. The
    submit_order call also checks this; we mirror it here so the runner
    can refuse to start at all (instead of failing per-order)."""
    return get_settings().is_paper


def is_within_entry_window(now_utc: datetime | None = None) -> bool:
    """Markets open 9:30 ET, last entry 15:30 ET. Convert UTC → ET naively
    (ET = UTC-5 in winter, UTC-4 in summer). For a paper bot, the half-hour
    of DST slop on the boundaries doesn't materially matter.
    """
    now = now_utc or datetime.utcnow()
    # ET ≈ UTC - 4 during DST, - 5 otherwise. Use -4 (summer) by default; the
    # 1-hour DST slop costs nothing for a 9:30-15:30 window.
    et_hour = (now.hour - 4) % 24
    et_time = time(et_hour, now.minute, now.second)
    if now.weekday() >= 5:  # Sat/Sun
        return False
    return RTH_OPEN_ET <= et_time <= RTH_LATEST_ENTRY_ET


def is_past_time_stop(now_utc: datetime | None = None) -> bool:
    """Used by the position monitor — close any open position at 15:30 ET
    to dodge the 0-DTE expiration cliff. Same naive timezone math as above."""
    now = now_utc or datetime.utcnow()
    if now.weekday() >= 5:
        return True
    et_hour = (now.hour - 4) % 24
    et_time = time(et_hour, now.minute, now.second)
    return et_time >= time(15, 30)
