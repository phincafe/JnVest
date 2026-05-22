"""Backtest harness for the SPY-divergence strategy.

Walks historical SPY 5m bars forward, runs the same detector the live bot
uses, and simulates option fills + TP/SL/time-stop exits using Black-Scholes
with a fixed IV assumption.

**Major caveat:** Alpaca free-tier historical data only covers stocks. We
simulate the option mark via BS from the underlying — the bot's REAL fills
will diverge because (a) real IV varies and is usually higher than 15% on
days when divergence fires, and (b) bid-ask spread + slippage isn't
modelled. Directionally informative; precise % returns are not reliable.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, time, timedelta

from .. import alpaca
from ..blackscholes import price as bs_price
from .detector import Bar, detect

ASSUMED_IV = 0.15  # fixed; user chose this over realized-vol per-bar.
TP_PCT = 0.20
SL_PCT = 0.20
DAILY_LOSS_CAP_PCT = 0.05  # mirror of safety.py
RISK_PCT = 0.02
STARTING_EQUITY = 10_000.0  # synthetic for sizing math during the backtest
MIN_BARS = 50  # same as runner — need RSI warmup + swing room


@dataclass
class SimTrade:
    entry_idx: int
    entry_ts: str
    side: str  # 'call' | 'put'
    spot_at_entry: float
    strike: float
    qty: int
    entry_mark: float
    exit_idx: int
    exit_ts: str
    spot_at_exit: float
    exit_mark: float
    exit_reason: str  # 'tp' | 'sl' | 'time'
    pnl: float


@dataclass
class BacktestResult:
    days_requested: int
    bars_loaded: int
    trades: list[dict]
    summary: dict


def _is_past_time_stop_et(bar_ts: datetime) -> bool:
    """Same naive ET approximation as services.bot.safety. Backtest uses UTC
    timestamps from Alpaca; convert UTC → ET via -4h (DST default — the
    1-hour winter slop costs nothing here)."""
    if bar_ts.weekday() >= 5:
        return True
    et_hour = (bar_ts.hour - 4) % 24
    et_time = time(et_hour, bar_ts.minute, bar_ts.second)
    return et_time >= time(15, 30)


async def run_backtest(days: int) -> BacktestResult:
    """Fetch the last `days` calendar days of SPY 5m bars and simulate trades.

    Returns a dict-friendly result. Caller wraps in a Pydantic response.
    """
    days = max(1, min(days, 90))  # cap to avoid runaway fetches
    start = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z")
    try:
        raw = await alpaca.bars("SPY", timeframe="5Min", start=start, limit=10_000)
    except Exception as e:
        return BacktestResult(
            days_requested=days, bars_loaded=0, trades=[], summary={"error": str(e)}
        )

    bars: list[Bar] = []
    timestamps: list[datetime] = []
    for b in raw:
        try:
            bars.append(
                Bar(open=float(b["o"]), high=float(b["h"]), low=float(b["l"]), close=float(b["c"]))
            )
            # Alpaca returns ISO 8601 with trailing Z; strip the Z so datetime.fromisoformat parses.
            ts = b.get("t", "")
            if isinstance(ts, str) and ts.endswith("Z"):
                ts = ts[:-1] + "+00:00"
            timestamps.append(datetime.fromisoformat(ts) if ts else datetime.utcnow())
        except Exception:
            continue

    if len(bars) < MIN_BARS:
        return BacktestResult(
            days_requested=days,
            bars_loaded=len(bars),
            trades=[],
            summary={"error": "not enough bars to detect"},
        )

    trades: list[SimTrade] = []
    equity = STARTING_EQUITY
    open_trade: SimTrade | None = None
    last_signal_idx = -1
    # Track day rollover for the daily loss cap, same as the live bot.
    current_day: str | None = None
    day_pnl = 0.0
    day_capped = False

    # Iterate forward — at each completed bar `i`, the detector can use
    # bars[0:i+1]; new trades open at bar i+1's open (next bar). Open trades
    # advance bar-by-bar.
    for i in range(MIN_BARS, len(bars) - 1):
        bar_ts = timestamps[i]
        bar_day = bar_ts.strftime("%Y-%m-%d")
        if bar_day != current_day:
            current_day = bar_day
            day_pnl = 0.0
            day_capped = False

        # --- 1. Monitor any open trade against this bar's close. ---
        if open_trade is not None:
            # Time-since-entry, in days, for BS.
            entry_ts = timestamps[open_trade.entry_idx]
            days_remaining_at_entry = max(
                0.001,
                (
                    timestamps[open_trade.entry_idx].replace(hour=20, minute=0, second=0) - entry_ts
                ).total_seconds()
                / 86400,
            )
            elapsed_days = (bar_ts - entry_ts).total_seconds() / 86400
            days_remaining = max(0.0, days_remaining_at_entry - elapsed_days)
            is_call = open_trade.side == "call"
            mark = bs_price(
                spot=bars[i].close,
                strike=open_trade.strike,
                iv=ASSUMED_IV,
                days_to_exp=days_remaining,
                is_call=is_call,
            )
            tp = open_trade.entry_mark * (1 + TP_PCT)
            sl = open_trade.entry_mark * (1 - SL_PCT)
            reason: str | None = None
            if mark >= tp:
                reason = "tp"
            elif mark <= sl:
                reason = "sl"
            elif _is_past_time_stop_et(bar_ts):
                reason = "time"
            if reason is not None:
                # Close at mark.
                pnl = (mark - open_trade.entry_mark) * 100.0 * open_trade.qty
                day_pnl += pnl
                equity += pnl
                trade = SimTrade(
                    entry_idx=open_trade.entry_idx,
                    entry_ts=timestamps[open_trade.entry_idx].isoformat(),
                    side=open_trade.side,
                    spot_at_entry=open_trade.spot_at_entry,
                    strike=open_trade.strike,
                    qty=open_trade.qty,
                    entry_mark=open_trade.entry_mark,
                    exit_idx=i,
                    exit_ts=bar_ts.isoformat(),
                    spot_at_exit=bars[i].close,
                    exit_mark=mark,
                    exit_reason=reason,
                    pnl=pnl,
                )
                trades.append(trade)
                open_trade = None
                if day_pnl <= -equity * DAILY_LOSS_CAP_PCT:
                    day_capped = True
            else:
                # Still open — skip new-trade logic this bar.
                continue

        # --- 2. Skip new entries if outside our trading window or capped. ---
        if day_capped:
            continue
        et_hour = (bar_ts.hour - 4) % 24
        et_time = time(et_hour, bar_ts.minute, bar_ts.second)
        if not (time(9, 30) <= et_time <= time(15, 30)):
            continue

        # --- 3. Run the detector on bars up to and including the current bar. ---
        sig = detect(bars[: i + 1])
        if sig is None or sig.index <= last_signal_idx:
            continue
        last_signal_idx = sig.index
        # Entry at next bar's open (i+1) — same convention live trading would use.
        entry_idx = i + 1
        spot_at_entry = bars[entry_idx].open
        # 0-DTE ATM call/put: strike rounded to nearest dollar, expiry 16:00 ET today.
        strike = round(spot_at_entry)
        # Days remaining = from entry_ts to today's 16:00 ET (≈20:00 UTC).
        entry_ts_b = timestamps[entry_idx]
        # Same crude DST-agnostic mapping the live bot uses.
        expiry_utc = entry_ts_b.replace(hour=20, minute=0, second=0, microsecond=0)
        days_remaining = max(0.001, (expiry_utc - entry_ts_b).total_seconds() / 86400)
        is_call = sig.side == "call"
        entry_mark = bs_price(
            spot=spot_at_entry,
            strike=strike,
            iv=ASSUMED_IV,
            days_to_exp=days_remaining,
            is_call=is_call,
        )
        if entry_mark <= 0.05:
            continue
        # Sizing — same risk-based formula the live bot uses.
        loss_per_contract = entry_mark * 100.0 * SL_PCT
        if loss_per_contract <= 0:
            continue
        raw_qty = (RISK_PCT * equity) / loss_per_contract
        qty = max(1, min(20, int(raw_qty)))
        open_trade = SimTrade(
            entry_idx=entry_idx,
            entry_ts=entry_ts_b.isoformat(),
            side=sig.side,
            spot_at_entry=spot_at_entry,
            strike=strike,
            qty=qty,
            entry_mark=entry_mark,
            exit_idx=-1,
            exit_ts="",
            spot_at_exit=0.0,
            exit_mark=0.0,
            exit_reason="",
            pnl=0.0,
        )

    # Close any still-open trade at the last bar (treat as time-stop).
    if open_trade is not None:
        i = len(bars) - 1
        bar_ts = timestamps[i]
        entry_ts = timestamps[open_trade.entry_idx]
        expiry_utc = entry_ts.replace(hour=20, minute=0, second=0)
        days_remaining = max(0.0, (expiry_utc - bar_ts).total_seconds() / 86400)
        is_call = open_trade.side == "call"
        mark = bs_price(
            spot=bars[i].close,
            strike=open_trade.strike,
            iv=ASSUMED_IV,
            days_to_exp=days_remaining,
            is_call=is_call,
        )
        pnl = (mark - open_trade.entry_mark) * 100.0 * open_trade.qty
        trades.append(
            SimTrade(
                entry_idx=open_trade.entry_idx,
                entry_ts=timestamps[open_trade.entry_idx].isoformat(),
                side=open_trade.side,
                spot_at_entry=open_trade.spot_at_entry,
                strike=open_trade.strike,
                qty=open_trade.qty,
                entry_mark=open_trade.entry_mark,
                exit_idx=i,
                exit_ts=bar_ts.isoformat(),
                spot_at_exit=bars[i].close,
                exit_mark=mark,
                exit_reason="time",
                pnl=pnl,
            )
        )

    # --- Summary stats ---
    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    total_pnl = sum(t.pnl for t in trades)
    win_rate = (len(wins) / len(trades) * 100.0) if trades else 0.0
    # Max drawdown from running equity curve.
    running = STARTING_EQUITY
    peak = STARTING_EQUITY
    max_dd = 0.0
    for t in trades:
        running += t.pnl
        peak = max(peak, running)
        dd = peak - running
        if dd > max_dd:
            max_dd = dd
    summary = {
        "starting_equity": STARTING_EQUITY,
        "ending_equity": STARTING_EQUITY + total_pnl,
        "total_pnl": round(total_pnl, 2),
        "total_pnl_pct": round(total_pnl / STARTING_EQUITY * 100.0, 2),
        "trade_count": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate_pct": round(win_rate, 1),
        "avg_win": round(sum(t.pnl for t in wins) / len(wins), 2) if wins else 0.0,
        "avg_loss": round(sum(t.pnl for t in losses) / len(losses), 2) if losses else 0.0,
        "max_drawdown": round(max_dd, 2),
        "max_drawdown_pct": round(max_dd / STARTING_EQUITY * 100.0, 2),
        "assumed_iv": ASSUMED_IV,
    }
    return BacktestResult(
        days_requested=days,
        bars_loaded=len(bars),
        trades=[asdict(t) for t in trades],
        summary=summary,
    )
