import asyncio
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import BrokerageAccountAlias, EquitySnapshot, WatchlistTicker
from ..services import alpaca, finnhub, snaptrade_svc, streamer
from ..services.errors import provider_error

router = APIRouter(prefix="/snaptrade", tags=["snaptrade"])

EARNINGS_FLAG_WINDOW_DAYS = 14


async def _attach_earnings_flags(flat: dict[str, Any]) -> None:
    """Stamp `earnings_days` (days until next report, within 14d) on every
    stock position and option row. Holding short-dated options into earnings
    is a classic gamma trap — surfacing this on the holdings tables beats
    discovering it after the IV crush.

    One cached Finnhub calendar call covers all symbols. Best-effort: any
    failure leaves rows unstamped and never breaks the holdings response."""
    try:
        earn = await finnhub.earnings_calendar(days_ahead=EARNINGS_FLAG_WINDOW_DAYS)
    except Exception:
        return
    today = datetime.utcnow().date()
    er_by_sym: dict[str, str] = {}
    for e in earn:
        s = (e.get("symbol") or "").upper()
        d = e.get("date")
        if s and d and (s not in er_by_sym or d < er_by_sym[s]):
            er_by_sym[s] = d

    def days_until(date_str: str | None) -> int | None:
        if not date_str:
            return None
        try:
            delta = (datetime.strptime(date_str, "%Y-%m-%d").date() - today).days
        except ValueError:
            return None
        return delta if delta >= 0 else None

    for row in flat["positions"]:
        row["earnings_days"] = days_until(er_by_sym.get((row.get("ticker") or "").upper()))
    for row in flat["options"]:
        row["earnings_days"] = days_until(er_by_sym.get((row.get("underlying") or "").upper()))


def _upsert_equity_snapshot(db: Session, flat: dict[str, Any]) -> None:
    """Record today's total account value for the equity curve. Runs on every
    holdings fetch — latest value of the day wins. Best-effort: a DB hiccup
    must never fail the holdings response."""
    totals = flat.get("totals") or {}
    equity = totals.get("equity")
    if equity is None:
        return
    today = datetime.utcnow().strftime("%Y-%m-%d")
    try:
        row = db.query(EquitySnapshot).filter(EquitySnapshot.as_of_date == today).first()
        if row is None:
            row = EquitySnapshot(as_of_date=today, equity=0.0, invested=0.0, cash=0.0)
            db.add(row)
        row.equity = float(equity)
        row.invested = float(totals.get("invested") or 0)
        row.cash = float(totals.get("cash") or 0)
        db.commit()
    except Exception:
        db.rollback()


@router.get("/equity-history")
def equity_history(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Daily equity snapshots for the Portfolio curve. Owner-only ($ amounts)."""
    from ..main import is_guest

    if is_guest(request):
        raise HTTPException(status_code=401, detail="owner login required")
    rows = db.query(EquitySnapshot).order_by(EquitySnapshot.as_of_date).all()
    return {
        "points": [
            {
                "date": r.as_of_date,
                "equity": r.equity,
                "invested": r.invested,
                "cash": r.cash,
            }
            for r in rows
        ]
    }


@router.get("/login-link")
def login_link(db: Session = Depends(get_db)) -> dict[str, str]:
    """Bootstraps a SnapTrade end-user (lazily) and returns a one-time URL the
    user opens to pick a brokerage and authorize. After they finish, they
    return to JnVest and we'll see the new connection in /authorizations."""
    try:
        user = snaptrade_svc.get_or_create_user(db)
        url = snaptrade_svc.login_link(user)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=provider_error("SnapTrade", e)) from e
    return {"url": url}


@router.get("/authorizations")
def list_authorizations(db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        user = snaptrade_svc.get_or_create_user(db)
        items = snaptrade_svc.list_authorizations(user)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=provider_error("SnapTrade", e)) from e
    return {"authorizations": items}


@router.delete("/authorizations/{authorization_id}")
def remove_authorization(authorization_id: str, db: Session = Depends(get_db)) -> dict[str, bool]:
    try:
        user = snaptrade_svc.get_or_create_user(db)
        snaptrade_svc.remove_authorization(user, authorization_id)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=provider_error("SnapTrade", e)) from e
    return {"ok": True}


def _safe_get(obj: Any, key: str, default: Any = None) -> Any:
    return obj.get(key, default) if isinstance(obj, dict) else default


def _ticker_of(symbol_field: Any) -> str | None:
    """SnapTrade nests stock tickers as {symbol: {symbol: 'AAPL'}} or sometimes
    just 'AAPL' or {symbol: 'AAPL'}. Walk a few levels safely."""
    cur = symbol_field
    for _ in range(4):
        if cur is None:
            return None
        if isinstance(cur, str):
            # Reject UUID-looking strings (Robinhood option_id leaks here sometimes).
            if len(cur) == 36 and cur.count("-") == 4:
                return None
            return cur
        if isinstance(cur, dict):
            cur = cur.get("symbol")
            continue
        return None
    return None


def _resolve_order_option(o: dict[str, Any]) -> dict[str, Any] | None:
    """Find the option-symbol dict on an order regardless of where it's nested.
    Some brokers attach it at the top level (`o.option_symbol`), some bury it
    inside `o.symbol.option_symbol`."""
    direct = _safe_get(o, "option_symbol")
    if isinstance(direct, dict) and direct:
        return direct
    nested = _safe_get(_safe_get(o, "symbol"), "option_symbol")
    if isinstance(nested, dict) and nested:
        return nested
    return None


# Money-market sweep tickers brokers report as both "cash" AND a position.
# We drop them from positions so they don't double-count — their value is
# already captured in the account's cash balance.
CASH_EQUIVALENT_TICKERS = {
    "SPAXX",  # Fidelity Government MMF
    "FCASH",  # Fidelity uninvested cash
    "FZFXX",  # Fidelity Treasury MMF
    "FDRXX",  # Fidelity Government Cash Reserves
    "FDIC",
    "VMFXX",  # Vanguard Federal MMF
    "SWVXX",  # Schwab Value Advantage MMF
    "VUSXX",  # Vanguard Treasury MMF
    "SPRXX",  # Fidelity MMF
}


def _to_occ_symbol(
    underlying: str | None,
    expiration: str | None,
    option_type: str | None,
    strike: float | int | None,
) -> str | None:
    """Build the OCC option symbol Alpaca expects: SYMBOLYYMMDDC|PSTRIKExxxxxxxx
    (strike × 1000, padded to 8 digits). Returns None if any field is missing."""
    if not underlying or not expiration or not option_type or strike is None:
        return None
    try:
        yy = expiration[2:4]
        mm = expiration[5:7]
        dd = expiration[8:10]
        cp = "C" if str(option_type).upper().startswith("C") else "P"
        strike_int = int(round(float(strike) * 1000))
        return f"{underlying.upper()}{yy}{mm}{dd}{cp}{strike_int:08d}"
    except (ValueError, TypeError):
        return None


def _alpaca_option_mid(snap: dict[str, Any]) -> float | None:
    """Pull a usable price out of an Alpaca options snapshot.
    Prefer mid of latest quote (bid+ask)/2; fall back to last trade."""
    if not isinstance(snap, dict):
        return None
    q = snap.get("latestQuote") or {}
    bp = float(q.get("bp") or 0)
    ap = float(q.get("ap") or 0)
    if bp > 0 and ap > 0:
        return (bp + ap) / 2.0
    t = snap.get("latestTrade") or {}
    p = float(t.get("p") or 0)
    return p if p > 0 else None


def _action_is_option(action: str | None) -> bool:
    """Heuristic: option order actions are BUY_OPEN / SELL_CLOSE / etc.
    Stock actions are BUY / SELL."""
    if not action:
        return False
    a = action.upper()
    return any(k in a for k in ("OPEN", "CLOSE")) and "_" in a


def _flatten(
    holdings: list[dict[str, Any]],
    prev_closes: dict[str, float] | None = None,
    option_quotes: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Map SnapTrade's per-account holdings into a UI-friendly shape.

    `prev_closes` (ticker → yesterday's close) is used to compute per-account
    today's-change for stock positions. Options aren't included since we don't
    have option prev-close data; per-account `today_pl_complete` flags whether
    the account is options-free.

    `option_quotes` (OCC symbol → live mid price per share) overrides
    SnapTrade's stale last-trade `price` field for option positions. Falls
    back to SnapTrade's price per option if the OCC isn't in the dict.
    """
    prev_closes = prev_closes or {}
    option_quotes = option_quotes or {}
    out_accounts: list[dict[str, Any]] = []
    stocks: list[dict[str, Any]] = []
    options: list[dict[str, Any]] = []
    orders: list[dict[str, Any]] = []
    total_value = 0.0
    total_cash = 0.0
    total_pl = 0.0
    total_today_pl = 0.0
    total_today_complete = True

    for entry in holdings:
        acct = entry.get("account") or {}
        acct_id = _safe_get(acct, "id")
        acct_name = _safe_get(acct, "name") or _safe_get(acct, "number") or "Account"
        broker = _safe_get(acct, "institution_name") or ""
        balances = entry.get("balances") or []
        bal_total = 0.0
        bal_cash = 0.0
        for b in balances:
            if not isinstance(b, dict):
                continue
            cur = _safe_get(b.get("currency"), "code")
            if cur and cur != "USD":
                continue
            bal_total += float(b.get("buying_power") or 0)
            bal_cash += float(b.get("cash") or 0)
        # Track per-account invested amount so we can derive equity reliably
        # (SnapTrade's total_value is often missing or just echoes cash for IRAs).
        acct_invested = 0.0
        acct_open_pl = 0.0
        acct_today_pl = 0.0
        # If the account has any option positions, today_pl is incomplete
        # because we don't have option prev-close data.
        acct_today_complete = True
        # If we drop a cash-equivalent (SPAXX etc.) that the broker also
        # reports as cash, SnapTrade's total_value is double-counting; trust
        # our computed equity over tv_raw in that case.
        had_cash_equivalent = False
        tv_raw = float(_safe_get(entry.get("total_value"), "value") or 0)
        total_cash += bal_cash

        for p in entry.get("positions") or []:
            if not isinstance(p, dict):
                continue
            sym = p.get("symbol") or {}
            ticker = _ticker_of(sym)
            if ticker and ticker.upper() in CASH_EQUIVALENT_TICKERS:
                had_cash_equivalent = True
                continue
            description = _safe_get(sym, "description") or _safe_get(
                _safe_get(sym, "symbol"), "description"
            )
            qty = float(p.get("units") or 0)
            price = float(p.get("price") or 0)
            avg_raw = p.get("average_purchase_price")
            avg = float(avg_raw) if avg_raw else None
            mkt_val = qty * price
            acct_invested += mkt_val
            cost = (qty * avg) if avg else None
            pl = (mkt_val - cost) if cost is not None else (float(p.get("open_pnl") or 0) or None)
            pl_pct = ((mkt_val - cost) / cost * 100.0) if cost else None
            if pl is not None:
                total_pl += pl
                acct_open_pl += pl
            # Today's change = (last_price - prev_close) * qty. Skip cleanly
            # if we don't have a prev_close for this ticker.
            pc = prev_closes.get((ticker or "").upper()) if ticker else None
            if pc and price and qty:
                acct_today_pl += (price - pc) * qty
            stocks.append(
                {
                    "account_id": acct_id,
                    "account": acct_name,
                    "broker": broker,
                    "ticker": ticker,
                    "description": description,
                    "quantity": qty,
                    "price": price,
                    "avg_cost": avg,
                    "market_value": mkt_val,
                    "unrealized_pl": pl,
                    "unrealized_pl_pct": pl_pct,
                }
            )

        for op in entry.get("option_positions") or []:
            if not isinstance(op, dict):
                continue
            sym = op.get("symbol") or {}
            opt_sym = _safe_get(sym, "option_symbol") or {}
            underlying = _ticker_of(_safe_get(opt_sym, "underlying_symbol")) or _ticker_of(sym)
            qty = float(op.get("units") or 0)
            # SnapTrade's per-share `price` is the LAST trade — for illiquid
            # long-dated options that's stale and can be 10-20% off the broker's
            # live mark. If we have a live Alpaca quote for this OCC symbol,
            # use the mid instead.
            occ = _to_occ_symbol(
                underlying,
                _safe_get(opt_sym, "expiration_date"),
                _safe_get(opt_sym, "option_type"),
                _safe_get(opt_sym, "strike_price"),
            )
            price_snaptrade = float(op.get("price") or 0)
            price = option_quotes.get(occ) if occ else None
            if price is None or price <= 0:
                price = price_snaptrade
            # SnapTrade quirk: `average_purchase_price` is the per-contract
            # dollar cost (already × the 100-share multiplier). So we apply
            # the multiplier to current value only, not to cost.
            avg_raw = op.get("average_purchase_price")
            avg_per_contract = float(avg_raw) if avg_raw else None
            multiplier = 100.0
            mkt_val = qty * price * multiplier
            acct_invested += mkt_val
            cost = (qty * avg_per_contract) if avg_per_contract else None
            pl = (mkt_val - cost) if cost is not None else None
            pl_pct = ((mkt_val - cost) / cost * 100.0) if cost else None
            if pl is not None:
                total_pl += pl
                acct_open_pl += pl
            # We don't fetch option prev-close, so any account holding options
            # gets an incomplete today_pl flag.
            acct_today_complete = False
            # Show the per-share avg in the UI (divide the per-contract figure)
            # so columns are visually comparable to `price`.
            avg_per_share = (avg_per_contract / multiplier) if avg_per_contract else None
            options.append(
                {
                    "account_id": acct_id,
                    "account": acct_name,
                    "broker": broker,
                    "underlying": underlying,
                    "ticker": _safe_get(opt_sym, "ticker"),
                    "option_type": _safe_get(opt_sym, "option_type"),
                    "strike": _safe_get(opt_sym, "strike_price"),
                    "expiration": _safe_get(opt_sym, "expiration_date"),
                    "quantity": qty,
                    "price": price,
                    "avg_cost": avg_per_share,
                    "market_value": mkt_val,
                    "unrealized_pl": pl,
                    "unrealized_pl_pct": pl_pct,
                }
            )

        for o in entry.get("orders") or []:
            if not isinstance(o, dict):
                continue
            opt_sym = _resolve_order_option(o)
            is_option = bool(opt_sym) or _action_is_option(o.get("action"))
            if opt_sym:
                ticker = _ticker_of(_safe_get(opt_sym, "underlying_symbol"))
                option_type = _safe_get(opt_sym, "option_type")
                strike = _safe_get(opt_sym, "strike_price")
                expiration = _safe_get(opt_sym, "expiration_date")
            else:
                ticker = None
                option_type = strike = expiration = None
            # Always try the universal symbol path as a backup for the underlying.
            if not ticker:
                ticker = (
                    _ticker_of(o.get("universal_symbol"))
                    or _ticker_of(o.get("quote_universal_symbol"))
                    or _ticker_of(o.get("symbol"))
                )
            orders.append(
                {
                    "account_id": acct_id,
                    "account": acct_name,
                    "broker": broker,
                    "ticker": ticker,
                    "is_option": is_option,
                    "option_type": option_type,
                    "strike": strike,
                    "expiration": expiration,
                    "action": o.get("action"),
                    "order_type": o.get("order_type"),
                    "status": o.get("status"),
                    "total_quantity": float(o.get("total_quantity") or 0) or None,
                    "filled_quantity": float(o.get("filled_quantity") or 0) or None,
                    "execution_price": (
                        float(o.get("execution_price"))
                        if o.get("execution_price") not in (None, "")
                        else None
                    ),
                    "time": o.get("time_executed") or o.get("time_placed"),
                }
            )

        # Per-account equity = cash + invested. Use SnapTrade's total_value
        # only if it's at least as big as cash + invested (i.e. it's actually
        # reporting account equity vs. just echoing cash). Otherwise our
        # computed value is more accurate. If we deduped a cash-equivalent
        # position (e.g. Fidelity SPAXX), SnapTrade's total_value double-
        # counted that money, so trust our computed value.
        computed_equity = bal_cash + acct_invested
        if had_cash_equivalent:
            acct_equity = computed_equity
        else:
            acct_equity = tv_raw if tv_raw >= computed_equity - 0.01 else computed_equity
        total_value += acct_equity

        # today_pl% is relative to start-of-day equity (= today's equity − today_pl)
        prev_equity = acct_equity - acct_today_pl
        today_pct = (acct_today_pl / prev_equity * 100.0) if prev_equity else None
        prev_invested = max(acct_invested - acct_open_pl, 0.0)
        open_pct = (acct_open_pl / prev_invested * 100.0) if prev_invested else None

        total_today_pl += acct_today_pl
        if not acct_today_complete:
            total_today_complete = False

        out_accounts.append(
            {
                "id": acct_id,
                "name": acct_name,
                "broker": broker,
                "type": _safe_get(_safe_get(acct, "meta"), "type") or _safe_get(acct, "raw_type"),
                "balance": acct_equity,
                "cash": bal_cash,
                "equity": acct_equity,
                "invested": acct_invested,
                "open_pl": acct_open_pl,
                "open_pl_pct": open_pct,
                "today_pl": acct_today_pl,
                "today_pl_pct": today_pct,
                "today_pl_complete": acct_today_complete,
            }
        )

    cost_basis = sum((s["quantity"] * s["avg_cost"]) for s in stocks if s.get("avg_cost")) + sum(
        (op["quantity"] * (op["avg_cost"] or 0) * 100) for op in options if op.get("avg_cost")
    )
    invested = sum(s["market_value"] for s in stocks) + sum(op["market_value"] for op in options)
    equity = total_value or (total_cash + invested)

    prev_total_equity = max(equity - total_today_pl, 0.0)
    today_pct_total = (total_today_pl / prev_total_equity * 100.0) if prev_total_equity else None

    return {
        "accounts": out_accounts,
        "positions": stocks,
        "options": options,
        "orders": orders[:25],
        "totals": {
            "equity": equity,
            "invested": invested,
            "cash": total_cash,
            "cost_basis": cost_basis,
            "unrealized_pl": total_pl,
            "today_pl": total_today_pl,
            "today_pl_pct": today_pct_total,
            "today_pl_complete": total_today_complete,
            # Legacy alias kept for any callers; will remove once UI migrates.
            "market_value": equity,
        },
    }


def _consolidate_for_guest(flat: dict[str, Any]) -> dict[str, Any]:
    """Collapse duplicates so a guest sees ONE row per (ticker) for stocks and
    ONE row per (underlying, type, strike, expiration) for options, no matter
    how many accounts hold them. Per-position dollar fields are removed; %
    allocation across the (anonymized) portfolio is kept."""
    total_invested = max(
        sum(p.get("market_value", 0) for p in flat["positions"])
        + sum(o.get("market_value", 0) for o in flat["options"]),
        1.0,
    )

    # ---- Stocks: collapse by ticker. Guests see weight only — no P/L. ----
    stock_groups: dict[str, float] = {}
    stock_descs: dict[str, str | None] = {}
    stock_er: dict[str, int | None] = {}
    for p in flat["positions"]:
        t = p.get("ticker") or "—"
        stock_groups[t] = stock_groups.get(t, 0.0) + (p.get("market_value") or 0)
        if t not in stock_descs:
            stock_descs[t] = p.get("description")
            stock_er[t] = p.get("earnings_days")
    consolidated_stocks = [
        {
            "ticker": t,
            "description": stock_descs.get(t),
            "earnings_days": stock_er.get(t),
            "allocation_pct": (v / total_invested * 100) if total_invested else None,
        }
        for t, v in stock_groups.items()
    ]
    consolidated_stocks.sort(key=lambda x: x.get("allocation_pct") or 0, reverse=True)

    # ---- Options: collapse by contract. Guests see weight only — no P/L. ----
    opt_groups: dict[tuple, float] = {}
    opt_meta: dict[tuple, dict[str, Any]] = {}
    for o in flat["options"]:
        key = (
            o.get("underlying"),
            o.get("option_type"),
            o.get("strike"),
            o.get("expiration"),
        )
        opt_groups[key] = opt_groups.get(key, 0.0) + (o.get("market_value") or 0)
        if key not in opt_meta:
            opt_meta[key] = {
                "underlying": o.get("underlying"),
                "option_type": o.get("option_type"),
                "strike": o.get("strike"),
                "expiration": o.get("expiration"),
                "earnings_days": o.get("earnings_days"),
            }
    consolidated_options = [
        {
            **opt_meta[k],
            "allocation_pct": (v / total_invested * 100) if total_invested else None,
        }
        for k, v in opt_groups.items()
    ]
    consolidated_options.sort(key=lambda x: x.get("allocation_pct") or 0, reverse=True)

    # ---- Orders: keep per-row for the activity feed but strip $ + qty ----
    consolidated_orders = []
    for o in flat["orders"]:
        consolidated_orders.append(
            {
                "ticker": o.get("ticker"),
                "is_option": o.get("is_option"),
                "option_type": o.get("option_type"),
                "strike": o.get("strike"),
                "expiration": o.get("expiration"),
                "action": o.get("action"),
                "status": o.get("status"),
                "time": o.get("time"),
                "account_id": None,
                "account": None,
                "broker": None,
                "total_quantity": None,
                "filled_quantity": None,
                "execution_price": None,
            }
        )

    return {
        "guest": True,
        "accounts": [],  # Guests don't see per-account info — that would re-leak distribution.
        "positions": consolidated_stocks,
        "options": consolidated_options,
        "orders": consolidated_orders,
        "totals": {
            "equity": None,
            "invested": None,
            "cash": None,
            "cost_basis": None,
            "unrealized_pl": None,
            "market_value": None,
        },
    }


async def _option_quotes_for_holdings(holdings: list[dict[str, Any]]) -> dict[str, float]:
    """Fetch live option mid quotes for every option position. Maps OCC symbol →
    per-share mid price. Failures fall back to {} (empty), which causes
    `_flatten` to keep using SnapTrade's stale last-trade price."""
    occs: list[str] = []
    for entry in holdings:
        for op in entry.get("option_positions") or []:
            if not isinstance(op, dict):
                continue
            opt_sym = _safe_get(op.get("symbol"), "option_symbol") or {}
            occ = _to_occ_symbol(
                _ticker_of(_safe_get(opt_sym, "underlying_symbol")) or _ticker_of(op.get("symbol")),
                _safe_get(opt_sym, "expiration_date"),
                _safe_get(opt_sym, "option_type"),
                _safe_get(opt_sym, "strike_price"),
            )
            if occ:
                occs.append(occ)
    if not occs:
        return {}
    snaps = await alpaca.option_snapshots(sorted(set(occs)))
    out: dict[str, float] = {}
    for occ, snap in snaps.items():
        mid = _alpaca_option_mid(snap)
        if mid is not None:
            out[occ] = mid
    return out


async def _prev_closes_for_holdings(holdings: list[dict[str, Any]]) -> dict[str, float]:
    """Fetch yesterday's close for every stock ticker held across all accounts.
    Used to compute per-account today's-change. Failures (no creds, API error)
    are swallowed and return an empty dict — today_pl just shows as $0."""
    tickers: set[str] = set()
    for entry in holdings:
        for p in entry.get("positions") or []:
            if not isinstance(p, dict):
                continue
            sym = p.get("symbol") or {}
            t = _ticker_of(sym)
            if t:
                tickers.add(t.upper())
    if not tickers:
        return {}
    try:
        bars = await alpaca.daily_bars(sorted(tickers), days=5)
    except Exception:
        return {}
    out: dict[str, float] = {}
    for t, sym_bars in bars.items():
        if not sym_bars:
            continue
        # Same convention as movers: -2 (yesterday) when we have 2+ bars,
        # else fall back to the only bar.
        b = sym_bars[-2] if len(sym_bars) >= 2 else sym_bars[-1]
        c = b.get("c")
        if c:
            out[t.upper()] = float(c)
    return out


@router.get("/holdings")
async def get_holdings(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        user = snaptrade_svc.get_or_create_user(db)
        raw = await snaptrade_svc.all_holdings(user)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=provider_error("SnapTrade", e)) from e
    prev_closes, option_quotes = await asyncio.gather(
        _prev_closes_for_holdings(raw),
        _option_quotes_for_holdings(raw),
    )
    flat = _flatten(raw, prev_closes=prev_closes, option_quotes=option_quotes)
    await _attach_earnings_flags(flat)
    _upsert_equity_snapshot(db, flat)
    # Apply user-chosen account nicknames.
    aliases = {a.account_id: a.nickname for a in db.query(BrokerageAccountAlias).all()}
    for acct in flat["accounts"]:
        if acct["id"] in aliases:
            acct["original_name"] = acct["name"]
            acct["name"] = aliases[acct["id"]]
    for collection in (flat["positions"], flat["options"], flat["orders"]):
        for row in collection:
            aid = row.get("account_id")
            if aid and aid in aliases:
                row["account"] = aliases[aid]

    # Guest mode: consolidate duplicates across accounts and hide $ amounts.
    from ..main import is_guest

    if is_guest(request):
        result = _consolidate_for_guest(flat)
        # Surface cash as % of total account value (cash + invested) so guests
        # see how aggressive vs defensive the portfolio is, without revealing
        # actual $ amounts.
        cash = sum(a.get("cash") or 0 for a in flat["accounts"])
        invested = sum(p["market_value"] for p in flat["positions"]) + sum(
            o["market_value"] for o in flat["options"]
        )
        total = cash + invested
        result["totals"] = {
            **(result.get("totals") or {}),
            "cash_pct": (cash / total * 100) if total else None,
            "invested_pct": (invested / total * 100) if total else None,
        }
        return result

    # Owner-only side effect: keep watchlist in sync with held tickers + option
    # underlyings. Idempotent — only adds genuinely new ones. Failures here
    # don't fail the holdings response.
    try:
        added = _auto_add_to_watchlist(db, flat)
        if added:
            flat["auto_added_to_watchlist"] = added
    except Exception:
        pass
    return flat


def _auto_add_to_watchlist(db: Session, flat: dict[str, Any]) -> list[str]:
    """Add every held ticker + option underlying to the watchlist if not already
    there. Returns the list of newly-added symbols. Idempotent."""
    tickers: set[str] = set()
    for s in flat["positions"]:
        t = s.get("ticker")
        q = s.get("quantity") or 0
        if t and q > 0:
            tickers.add(t.upper())
    for o in flat["options"]:
        u = o.get("underlying")
        if u:
            tickers.add(u.upper())
    if not tickers:
        return []
    existing = {r.symbol for r in db.query(WatchlistTicker).all()}
    new_syms = sorted(tickers - existing)
    if not new_syms:
        return []
    next_order = db.query(WatchlistTicker).order_by(WatchlistTicker.sort_order.desc()).first()
    base_order = (next_order.sort_order + 1) if next_order else 0
    for i, sym in enumerate(new_syms):
        db.add(WatchlistTicker(symbol=sym, sort_order=base_order + i))
    db.commit()
    streamer.notify_watchlist_changed()
    return new_syms


class NicknameIn(BaseModel):
    nickname: str = Field(min_length=1, max_length=128)


@router.put("/account/{account_id}/nickname")
def set_nickname(
    account_id: str, payload: NicknameIn, db: Session = Depends(get_db)
) -> dict[str, str]:
    nickname = payload.nickname.strip()
    if not nickname:
        raise HTTPException(status_code=400, detail="nickname cannot be empty")
    existing = (
        db.query(BrokerageAccountAlias)
        .filter(BrokerageAccountAlias.account_id == account_id)
        .first()
    )
    if existing:
        existing.nickname = nickname
    else:
        db.add(BrokerageAccountAlias(account_id=account_id, nickname=nickname))
    db.commit()
    return {"account_id": account_id, "nickname": nickname}


@router.delete("/account/{account_id}/nickname")
def clear_nickname(account_id: str, db: Session = Depends(get_db)) -> dict[str, bool]:
    db.query(BrokerageAccountAlias).filter(BrokerageAccountAlias.account_id == account_id).delete()
    db.commit()
    return {"ok": True}


@router.post("/sync-watchlist")
async def sync_to_watchlist(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Manual trigger of the same auto-sync that runs on every /holdings call.
    Kept as a POST for users who want to force a fresh sync after trading."""
    try:
        user = snaptrade_svc.get_or_create_user(db)
        raw = await snaptrade_svc.all_holdings(user)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=provider_error("SnapTrade", e)) from e

    flat = _flatten(raw)
    new_syms = _auto_add_to_watchlist(db, flat)
    held_tickers = {s["ticker"].upper() for s in flat["positions"] if s.get("ticker")} | {
        o["underlying"].upper() for o in flat["options"] if o.get("underlying")
    }
    skipped = len(held_tickers - set(new_syms))
    return {
        "added": len(new_syms),
        "skipped_existing": skipped,
        "tickers": new_syms,
    }


@router.get("/debug")
async def debug(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Owner-only diagnostic dump: per-account totals reported by SnapTrade vs.
    our computed values, plus per-position raw price + computed market value.
    Use this to track down discrepancies vs. what the broker shows in-app."""
    from ..main import is_guest

    if is_guest(request):
        raise HTTPException(status_code=403, detail="Owner only")
    try:
        user = snaptrade_svc.get_or_create_user(db)
        raw = await snaptrade_svc.all_holdings(user)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=provider_error("SnapTrade", e)) from e

    prev_closes, option_quotes = await asyncio.gather(
        _prev_closes_for_holdings(raw),
        _option_quotes_for_holdings(raw),
    )
    out: list[dict[str, Any]] = []
    for entry in raw:
        acct = entry.get("account") or {}
        # Per-account totals as SnapTrade reports them, plus what we'd compute.
        balances = entry.get("balances") or []
        bal_cash = 0.0
        bal_buying_power = 0.0
        for b in balances:
            if not isinstance(b, dict):
                continue
            cur = _safe_get(b.get("currency"), "code")
            if cur and cur != "USD":
                continue
            bal_cash += float(b.get("cash") or 0)
            bal_buying_power += float(b.get("buying_power") or 0)

        positions_dump: list[dict[str, Any]] = []
        invested = 0.0
        had_cash_equivalent = False
        for p in entry.get("positions") or []:
            if not isinstance(p, dict):
                continue
            sym = p.get("symbol") or {}
            ticker = _ticker_of(sym)
            qty = float(p.get("units") or 0)
            price = float(p.get("price") or 0)
            avg = p.get("average_purchase_price")
            mkt_val = qty * price
            is_cash_equiv = bool(ticker and ticker.upper() in CASH_EQUIVALENT_TICKERS)
            if is_cash_equiv:
                had_cash_equivalent = True
            else:
                invested += mkt_val
            pc = prev_closes.get((ticker or "").upper()) if ticker else None
            today_change = ((price - pc) * qty) if (pc and price and qty) else None
            positions_dump.append(
                {
                    "ticker": ticker,
                    "qty": qty,
                    "snaptrade_price": price,
                    "snaptrade_avg_purchase_price": float(avg) if avg else None,
                    "computed_market_value": mkt_val,
                    "alpaca_prev_close": pc,
                    "today_change": today_change,
                    "cash_equivalent_dropped": is_cash_equiv,
                }
            )

        options_dump: list[dict[str, Any]] = []
        for op in entry.get("option_positions") or []:
            if not isinstance(op, dict):
                continue
            sym = op.get("symbol") or {}
            opt_sym = _safe_get(sym, "option_symbol") or {}
            underlying = _ticker_of(_safe_get(opt_sym, "underlying_symbol")) or _ticker_of(sym)
            qty = float(op.get("units") or 0)
            price_snaptrade = float(op.get("price") or 0)
            avg = op.get("average_purchase_price")
            occ = _to_occ_symbol(
                underlying,
                _safe_get(opt_sym, "expiration_date"),
                _safe_get(opt_sym, "option_type"),
                _safe_get(opt_sym, "strike_price"),
            )
            alpaca_mid = option_quotes.get(occ) if occ else None
            effective_price = (
                alpaca_mid if (alpaca_mid is not None and alpaca_mid > 0) else price_snaptrade
            )
            mkt_val = qty * effective_price * 100.0
            invested += mkt_val
            options_dump.append(
                {
                    "underlying": underlying,
                    "ticker": _safe_get(opt_sym, "ticker"),
                    "occ_symbol": occ,
                    "option_type": _safe_get(opt_sym, "option_type"),
                    "strike": _safe_get(opt_sym, "strike_price"),
                    "expiration": _safe_get(opt_sym, "expiration_date"),
                    "qty": qty,
                    "snaptrade_price_per_share": price_snaptrade,
                    "alpaca_mid_per_share": alpaca_mid,
                    "effective_price_per_share": effective_price,
                    "snaptrade_avg_per_contract": float(avg) if avg else None,
                    "computed_market_value": mkt_val,
                    "raw_keys": sorted(op.keys()),
                }
            )

        snaptrade_total_value = float(_safe_get(entry.get("total_value"), "value") or 0)
        computed_equity = bal_cash + invested
        out.append(
            {
                "account": {
                    "id": _safe_get(acct, "id"),
                    "name": _safe_get(acct, "name") or _safe_get(acct, "number"),
                    "broker": _safe_get(acct, "institution_name"),
                },
                "snaptrade_reported": {
                    "total_value": snaptrade_total_value,
                    "cash": bal_cash,
                    "buying_power": bal_buying_power,
                },
                "computed": {
                    "invested": invested,
                    "equity": computed_equity,
                    "diff_vs_snaptrade_total": (
                        computed_equity - snaptrade_total_value if snaptrade_total_value else None
                    ),
                    "had_cash_equivalent_dropped": had_cash_equivalent,
                },
                "positions": positions_dump,
                "options": options_dump,
                "balances_raw": balances,
            }
        )
    return {"accounts": out}
