"""Defends against the AttributeError that took down /api/snaptrade/holdings:
SnapTrade returns the `symbol` field as a string in some contexts and a nested
dict in others. _flatten() must tolerate both."""

from app.routers.snaptrade import _flatten, _ticker_of


def test_ticker_of_handles_mixed_shapes():
    assert _ticker_of("AAPL") == "AAPL"
    assert _ticker_of({"symbol": "AAPL"}) == "AAPL"
    assert _ticker_of({"symbol": {"symbol": "AAPL"}}) == "AAPL"
    assert _ticker_of({"symbol": {"symbol": {"symbol": "AAPL"}}}) == "AAPL"
    assert _ticker_of(None) is None
    assert _ticker_of({}) is None


def test_flatten_handles_string_symbol_in_orders():
    fixture = [
        {
            "account": {"id": "a1", "name": "RH IRA", "institution_name": "Robinhood"},
            "orders": [
                {"symbol": "AAPL", "action": "BUY", "status": "EXECUTED"},
                {"symbol": {"symbol": {"symbol": "NVDA"}}, "action": "SELL"},
            ],
        }
    ]
    out = _flatten(fixture)
    tickers = [o["ticker"] for o in out["orders"]]
    assert tickers == ["AAPL", "NVDA"]


def test_flatten_handles_string_symbol_in_positions():
    fixture = [
        {
            "account": {"id": "a1", "name": "RH IRA"},
            "positions": [
                {"symbol": "NVDA", "units": 5, "price": 800, "average_purchase_price": 700},
            ],
        }
    ]
    out = _flatten(fixture)
    assert out["positions"][0]["ticker"] == "NVDA"
    assert out["positions"][0]["unrealized_pl"] == 500.0


def test_flatten_with_minimal_account_doesnt_crash():
    # Truly empty / partial entries shouldn't blow up.
    out = _flatten([{"account": {"id": "a1", "name": "X"}}])
    assert out["accounts"][0]["id"] == "a1"
    assert out["positions"] == []
    assert out["options"] == []
    assert out["orders"] == []
