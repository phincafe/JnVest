"""Sanity checks on Black-Scholes greeks. Numbers are textbook approximations."""

from app.services.blackscholes import greeks


def test_atm_call_30d_delta_around_half():
    g = greeks(spot=100, strike=100, iv=0.30, days_to_exp=30, is_call=True)
    assert g is not None
    # ATM call delta should be near 0.5 (slightly higher with positive r).
    assert 0.4 < g["delta"] < 0.7


def test_put_call_delta_relationship():
    call = greeks(spot=100, strike=100, iv=0.30, days_to_exp=30, is_call=True)
    put = greeks(spot=100, strike=100, iv=0.30, days_to_exp=30, is_call=False)
    assert call is not None and put is not None
    # Call delta - Put delta ≈ 1 (no dividends).
    assert abs((call["delta"] - put["delta"]) - 1.0) < 0.05


def test_atm_gamma_positive():
    g = greeks(spot=100, strike=100, iv=0.30, days_to_exp=30, is_call=True)
    assert g is not None
    assert g["gamma"] > 0


def test_atm_theta_negative_for_long_options():
    call = greeks(spot=100, strike=100, iv=0.30, days_to_exp=30, is_call=True)
    put = greeks(spot=100, strike=100, iv=0.30, days_to_exp=30, is_call=False)
    assert call is not None and put is not None
    assert call["theta"] < 0
    assert put["theta"] < 0


def test_invalid_inputs_return_none():
    assert greeks(spot=0, strike=100, iv=0.3, days_to_exp=30, is_call=True) is None
    assert greeks(spot=100, strike=100, iv=0, days_to_exp=30, is_call=True) is None
    assert greeks(spot=100, strike=100, iv=0.3, days_to_exp=0, is_call=True) is None


def test_deep_itm_call_delta_near_one():
    g = greeks(spot=200, strike=100, iv=0.30, days_to_exp=30, is_call=True)
    assert g is not None
    assert g["delta"] > 0.95
