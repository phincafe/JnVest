"""Pure-function indicators. Unit tested."""

from collections.abc import Sequence


def sma(values: Sequence[float], period: int) -> list[float | None]:
    """Simple moving average. Returns a list of same length; None where not enough data."""
    if period <= 0:
        raise ValueError("period must be > 0")
    out: list[float | None] = []
    running = 0.0
    for i, v in enumerate(values):
        running += v
        if i >= period:
            running -= values[i - period]
        if i >= period - 1:
            out.append(running / period)
        else:
            out.append(None)
    return out


def rsi(values: Sequence[float], period: int = 14) -> list[float | None]:
    """Wilder's RSI. Returns a list of same length; None where not enough data."""
    n = len(values)
    out: list[float | None] = [None] * n
    if n <= period:
        return out
    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        diff = values[i] - values[i - 1]
        if diff >= 0:
            gains += diff
        else:
            losses -= diff
    avg_gain = gains / period
    avg_loss = losses / period
    out[period] = _rsi_from_avgs(avg_gain, avg_loss)
    for i in range(period + 1, n):
        diff = values[i] - values[i - 1]
        gain = max(diff, 0.0)
        loss = max(-diff, 0.0)
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        out[i] = _rsi_from_avgs(avg_gain, avg_loss)
    return out


def _rsi_from_avgs(avg_gain: float, avg_loss: float) -> float:
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def iv_rank(current_iv: float, history: Sequence[float]) -> float | None:
    """IV Rank = (current - min) / (max - min) * 100, scaled 0..100.

    Returns None if history is empty or has zero range.
    """
    if not history:
        return None
    lo = min(history)
    hi = max(history)
    if hi == lo:
        return None
    rank = (current_iv - lo) / (hi - lo) * 100.0
    return max(0.0, min(100.0, rank))


def iv_percentile(current_iv: float, history: Sequence[float]) -> float | None:
    """IV Percentile = % of historical days where IV was below current_iv."""
    if not history:
        return None
    below = sum(1 for v in history if v < current_iv)
    return (below / len(history)) * 100.0
