import math

from app.services.indicators import iv_percentile, iv_rank, rsi, sma


def test_sma_basic():
    out = sma([1, 2, 3, 4, 5], 3)
    assert out[:2] == [None, None]
    assert math.isclose(out[2], 2.0)
    assert math.isclose(out[3], 3.0)
    assert math.isclose(out[4], 4.0)


def test_sma_period_too_long():
    out = sma([1.0, 2.0], 5)
    assert out == [None, None]


def test_rsi_classic_example():
    # Wilder's textbook 14-period example values (Cutler-style would differ).
    closes = [
        44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
        45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00,
        46.03, 46.41, 46.22, 45.64,
    ]
    out = rsi(closes, 14)
    # First 14 entries are None (need period+1 prices for first value).
    assert out[13] is None
    # 15th entry (index 14) should be the first computed RSI.
    assert out[14] is not None
    # Within reasonable bounds.
    assert 50.0 < out[14] < 90.0


def test_iv_rank_normal():
    history = [10.0, 20.0, 30.0, 40.0, 50.0]
    assert iv_rank(30.0, history) == 50.0
    assert iv_rank(10.0, history) == 0.0
    assert iv_rank(50.0, history) == 100.0


def test_iv_rank_clamped():
    history = [10.0, 50.0]
    assert iv_rank(60.0, history) == 100.0
    assert iv_rank(5.0, history) == 0.0


def test_iv_rank_flat_history_returns_none():
    assert iv_rank(20.0, [20.0, 20.0, 20.0]) is None
    assert iv_rank(20.0, []) is None


def test_iv_percentile():
    history = [10.0, 20.0, 30.0, 40.0]
    # 30 is greater than 10 and 20 -> 2/4 = 50%.
    assert iv_percentile(30.0, history) == 50.0
    assert iv_percentile(5.0, history) == 0.0
    assert iv_percentile(100.0, history) == 100.0
