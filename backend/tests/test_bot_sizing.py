from app.services.bot.sizing import MAX_QTY, size_for_risk


def test_normal_sizing() -> None:
    # $10k equity, -2% risk = $200 budget. Option at $5 → 5*100*0.20 = $100
    # loss/contract at stop → 200/100 = 2 contracts.
    assert size_for_risk(equity=10_000, entry_mark=5.0) == 2


def test_floors_to_one_when_risk_below_one_contract() -> None:
    # Tiny account, expensive option → math says <1, we floor to 1.
    assert size_for_risk(equity=500, entry_mark=10.0) == 1


def test_caps_at_max_qty() -> None:
    # Huge account, cheap option → math says >MAX_QTY, we cap.
    assert size_for_risk(equity=1_000_000, entry_mark=0.50) == MAX_QTY


def test_zero_on_bad_inputs() -> None:
    assert size_for_risk(equity=0, entry_mark=5.0) == 0
    assert size_for_risk(equity=10_000, entry_mark=0) == 0
    assert size_for_risk(equity=10_000, entry_mark=5.0, stop_pct=0) == 0
