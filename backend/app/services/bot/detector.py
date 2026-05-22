"""RSI(14) divergence detection on 5-minute bars.

Pure functions, no I/O — designed to be unit-tested with synthetic bar
sequences. The runner feeds in the latest N bars and gets back either
None or a `Signal`.

**Bullish divergence** (signals BUY CALL):
- Price made a lower low vs the prior swing low
- RSI made a higher low at the corresponding point
- Interpretation: selling momentum is weakening even as price falls further

**Bearish divergence** (signals BUY PUT):
- Price made a higher high vs the prior swing high
- RSI made a lower high
- Interpretation: buying momentum is weakening even as price pushes higher
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..indicators import rsi as _rsi


@dataclass(frozen=True)
class Signal:
    side: Literal["call", "put"]
    # The bar index (in the passed-in `bars` list) where the signal triggered.
    # Used so the runner can dedupe consecutive ticks against the same signal.
    index: int
    # Diagnostic values for the signal log.
    prior_extreme_price: float
    current_extreme_price: float
    prior_extreme_rsi: float
    current_extreme_rsi: float


@dataclass(frozen=True)
class Bar:
    """Subset of an OHLCV bar we actually use. Open is unused but kept so
    callers can pass through Alpaca's payload without remapping."""

    open: float
    high: float
    low: float
    close: float


def _find_local_lows(values: list[float], width: int = 2) -> list[int]:
    """Return indices where `values[i]` is strictly less than its `width`
    neighbours on each side. Skips the edges where the window doesn't fit."""
    out: list[int] = []
    for i in range(width, len(values) - width):
        v = values[i]
        left = min(values[i - width : i])
        right = min(values[i + 1 : i + 1 + width])
        if v < left and v < right:
            out.append(i)
    return out


def _find_local_highs(values: list[float], width: int = 2) -> list[int]:
    out: list[int] = []
    for i in range(width, len(values) - width):
        v = values[i]
        left = max(values[i - width : i])
        right = max(values[i + 1 : i + 1 + width])
        if v > left and v > right:
            out.append(i)
    return out


def detect(
    bars: list[Bar],
    rsi_period: int = 14,
    swing_width: int = 2,
    lookback: int = 30,
    min_bars_between: int = 3,
    min_rsi_gap: float = 0.0,
    min_price_gap_pct: float = 0.0,
) -> Signal | None:
    """Scan the most recent `lookback` bars for an RSI-vs-price divergence.

    Returns a Signal or None. Only the most recent pair of swing points is
    considered; older divergences are ignored (they're stale).

    `swing_width` = how many bars on each side of a candidate point must be
    higher/lower for it to count as a local high/low. width=2 means the
    point is the lowest/highest of 5 consecutive bars.

    `min_bars_between` = require at least this many bars between the prior
    and current swing points so we don't compare neighbours.

    `min_rsi_gap` = require |current_rsi - prior_rsi| ≥ this (RSI points).
    Defaults to 0 (any gap counts). Higher values filter out weak divergences
    where the RSI barely moved; commonly 3-8 in practice.

    `min_price_gap_pct` = require |current_price - prior_price| / prior_price
    × 100 ≥ this percent. Defaults to 0. Filters out trivial swings that are
    visually divergent but not material moves.
    """
    if len(bars) < max(rsi_period + 5, lookback):
        return None

    closes = [b.close for b in bars]
    lows = [b.low for b in bars]
    highs = [b.high for b in bars]
    rsis = _rsi(closes, rsi_period)

    # Operate on the trailing `lookback` window.
    window_start = max(0, len(bars) - lookback)

    # ---- Bullish divergence: lower low in price, higher low in RSI ----
    low_idxs = [i for i in _find_local_lows(lows, swing_width) if i >= window_start]
    if len(low_idxs) >= 2:
        prior, curr = low_idxs[-2], low_idxs[-1]
        prior_rsi, curr_rsi = rsis[prior], rsis[curr]
        if (
            curr - prior >= min_bars_between
            and prior_rsi is not None
            and curr_rsi is not None
            and lows[curr] < lows[prior]
            and curr_rsi > prior_rsi
        ):
            rsi_gap = curr_rsi - prior_rsi
            price_gap_pct = abs(lows[curr] - lows[prior]) / lows[prior] * 100 if lows[prior] else 0
            if rsi_gap >= min_rsi_gap and price_gap_pct >= min_price_gap_pct:
                return Signal(
                    side="call",
                    index=curr,
                    prior_extreme_price=lows[prior],
                    current_extreme_price=lows[curr],
                    prior_extreme_rsi=prior_rsi,
                    current_extreme_rsi=curr_rsi,
                )

    # ---- Bearish divergence: higher high in price, lower high in RSI ----
    high_idxs = [i for i in _find_local_highs(highs, swing_width) if i >= window_start]
    if len(high_idxs) >= 2:
        prior, curr = high_idxs[-2], high_idxs[-1]
        prior_rsi, curr_rsi = rsis[prior], rsis[curr]
        if (
            curr - prior >= min_bars_between
            and prior_rsi is not None
            and curr_rsi is not None
            and highs[curr] > highs[prior]
            and curr_rsi < prior_rsi
        ):
            rsi_gap = prior_rsi - curr_rsi
            price_gap_pct = (
                abs(highs[curr] - highs[prior]) / highs[prior] * 100 if highs[prior] else 0
            )
            if rsi_gap >= min_rsi_gap and price_gap_pct >= min_price_gap_pct:
                return Signal(
                    side="put",
                    index=curr,
                    prior_extreme_price=highs[prior],
                    current_extreme_price=highs[curr],
                    prior_extreme_rsi=prior_rsi,
                    current_extreme_rsi=curr_rsi,
                )

    return None
