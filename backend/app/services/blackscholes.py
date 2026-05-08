"""Pure-function Black-Scholes-Merton greeks.

yfinance returns IV but not greeks; we compute delta/gamma/theta/vega ourselves so
the user has *something* to filter on. Will not match a broker exactly — IV inputs
are end-of-day or last-print and the risk-free rate is a default.
"""

from math import erf, exp, log, pi, sqrt

DAYS_PER_YEAR = 365.0


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + erf(x / sqrt(2.0)))


def _norm_pdf(x: float) -> float:
    return exp(-0.5 * x * x) / sqrt(2.0 * pi)


def _d1(S: float, K: float, r: float, q: float, sigma: float, T: float) -> float:
    return (log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrt(T))


def greeks(
    spot: float,
    strike: float,
    iv: float,
    days_to_exp: float,
    is_call: bool,
    risk_free: float = 0.05,
    dividend_yield: float = 0.0,
) -> dict[str, float] | None:
    """Returns {delta, gamma, theta, vega} or None if inputs are invalid.

    theta is per-day (divide by 365). vega is per 1.00 vol-point (so multiply by 0.01
    if you want per 1% vol move).
    """
    if (
        spot <= 0
        or strike <= 0
        or iv <= 0
        or days_to_exp <= 0
        or not (0 < iv < 5)
    ):
        return None
    T = days_to_exp / DAYS_PER_YEAR
    sigma = iv
    try:
        d1 = _d1(spot, strike, risk_free, dividend_yield, sigma, T)
    except (ValueError, ZeroDivisionError):
        return None
    d2 = d1 - sigma * sqrt(T)
    Nd1 = _norm_cdf(d1)
    Nd2 = _norm_cdf(d2)
    n_d1 = _norm_pdf(d1)

    if is_call:
        delta = exp(-dividend_yield * T) * Nd1
        theta = (
            -spot * n_d1 * sigma * exp(-dividend_yield * T) / (2.0 * sqrt(T))
            - risk_free * strike * exp(-risk_free * T) * Nd2
            + dividend_yield * spot * exp(-dividend_yield * T) * Nd1
        ) / DAYS_PER_YEAR
    else:
        delta = -exp(-dividend_yield * T) * (1.0 - Nd1)
        theta = (
            -spot * n_d1 * sigma * exp(-dividend_yield * T) / (2.0 * sqrt(T))
            + risk_free * strike * exp(-risk_free * T) * (1.0 - Nd2)
            - dividend_yield * spot * exp(-dividend_yield * T) * (1.0 - Nd1)
        ) / DAYS_PER_YEAR

    gamma = exp(-dividend_yield * T) * n_d1 / (spot * sigma * sqrt(T))
    vega = spot * exp(-dividend_yield * T) * n_d1 * sqrt(T) * 0.01  # per 1% vol move

    return {
        "delta": delta,
        "gamma": gamma,
        "theta": theta,
        "vega": vega,
    }
