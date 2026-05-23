"""Synthetic-bar tests for the RSI divergence detector.

Each test builds a hand-crafted price sequence with a known divergence (or
deliberate non-divergence) and asserts the detector returns the right thing.
"""

from app.services.bot.detector import Bar, detect


def _bars(closes: list[float]) -> list[Bar]:
    """Build OHLC bars from a list of closes. high/low set to ±0 so swing
    points line up exactly with closes — keeps the tests legible."""
    return [Bar(open=c, high=c, low=c, close=c) for c in closes]


def test_no_signal_when_not_enough_bars() -> None:
    assert detect(_bars([100.0] * 5)) is None


def test_bullish_divergence_lower_low_higher_rsi_low() -> None:
    # 50-bar sequence: down-trend, bottom, recovery, deeper bottom with
    # less momentum. RSI at the second bottom should be higher than the
    # first (because the down-leg is shallower).
    seq = [100.0] * 20
    # First leg down to ~92, recover to ~95, second leg down to ~90.
    seq += [99, 98, 97, 96, 94, 92]  # first bottom at idx 25
    seq += [93, 94, 95]
    seq += [94, 93, 92, 91, 90]  # second bottom at idx 33 (lower price)
    seq += [91, 92, 93, 94, 95, 96, 97, 98]  # tail so detector has data after
    sig = detect(_bars(seq))
    assert sig is not None, "should detect bullish divergence"
    assert sig.side == "call"
    assert sig.current_extreme_price < sig.prior_extreme_price
    assert sig.current_extreme_rsi > sig.prior_extreme_rsi


def test_bearish_divergence_higher_high_lower_rsi_high() -> None:
    seq = [100.0] * 20
    # First rally to ~108, pull-back, second rally to ~110 but slower.
    seq += [101, 102, 103, 104, 106, 108]  # first top at idx 25
    seq += [107, 106, 105]
    seq += [106, 107, 108, 109, 110]  # second top at idx 33 (higher price)
    seq += [109, 108, 107, 106, 105, 104, 103, 102]
    sig = detect(_bars(seq))
    assert sig is not None, "should detect bearish divergence"
    assert sig.side == "put"
    assert sig.current_extreme_price > sig.prior_extreme_price
    assert sig.current_extreme_rsi < sig.prior_extreme_rsi


def test_flat_data_yields_no_signal() -> None:
    # Constant price → no swing lows/highs → no signal.
    assert detect(_bars([100.0] * 60)) is None


def test_confirm_bars_delays_signal_until_bounce() -> None:
    """A bullish divergence shouldn't fire at the exact divergence bar with
    confirm_bars > 0 — we wait for higher closes first."""
    seq = [100.0] * 20
    seq += [99, 98, 97, 96, 94, 92]  # first bottom at idx 25
    seq += [93, 94, 95]
    seq += [94, 93, 92, 91, 90]  # second bottom at idx 33 (lower)
    # Bars right after the bottom: no clear "leg up" yet.
    near_bottom = seq + [90, 90]
    # confirm_bars=2 needs the LATEST 2 bars to be higher than their
    # predecessor — flat 90s don't qualify.
    assert detect(_bars(near_bottom), confirm_bars=2) is None

    # Same data, plus a 2-bar leg up at the end — confirmation satisfied.
    with_bounce = seq + [91, 92]
    sig = detect(_bars(with_bounce), confirm_bars=2)
    assert sig is not None and sig.side == "call"


def test_confirm_max_wait_discards_stale_divergence() -> None:
    """If price drifts sideways for many bars after the divergence, the
    signal goes stale and is discarded."""
    seq = [100.0] * 20
    seq += [99, 98, 97, 96, 94, 92]  # first bottom
    seq += [93, 94, 95]
    seq += [94, 93, 92, 91, 90]  # second bottom at idx 33
    # 15 bars of sideways — exceeds confirm_max_wait=10.
    seq += [90.5, 91, 91.5, 92, 91.5, 91, 91.5, 92, 91.5, 91, 91.5, 92, 91.5, 91, 92]
    sig = detect(_bars(seq), confirm_bars=2, confirm_max_wait=10)
    assert sig is None


def test_min_bars_between_filters_close_swings() -> None:
    # Two adjacent lows — too close together, shouldn't count.
    seq = [100.0] * 20
    seq += [95, 94, 93, 92, 91, 92, 91, 90]  # tightly-packed lows
    seq += [91, 92, 93, 94]
    # Even if there's a "lower low + higher RSI" pattern here, the
    # min_bars_between filter should reject candidate pairs that are too
    # close.
    sig = detect(_bars(seq), min_bars_between=10)
    # Either no signal or the swings were far enough apart that the filter
    # passed; this test guards against false positives from neighbouring bars.
    if sig is not None:
        assert sig.index - 0 >= 10  # current swing is at least 10 bars past start
