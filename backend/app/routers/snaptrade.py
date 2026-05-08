from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import BrokerageAccountAlias, WatchlistTicker
from ..services import snaptrade_svc, streamer

router = APIRouter(prefix="/snaptrade", tags=["snaptrade"])


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
        raise HTTPException(status_code=502, detail=f"SnapTrade error: {e}") from e
    return {"url": url}


@router.get("/authorizations")
def list_authorizations(db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        user = snaptrade_svc.get_or_create_user(db)
        items = snaptrade_svc.list_authorizations(user)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SnapTrade error: {e}") from e
    return {"authorizations": items}


@router.delete("/authorizations/{authorization_id}")
def remove_authorization(authorization_id: str, db: Session = Depends(get_db)) -> dict[str, bool]:
    try:
        user = snaptrade_svc.get_or_create_user(db)
        snaptrade_svc.remove_authorization(user, authorization_id)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SnapTrade error: {e}") from e
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


def _action_is_option(action: str | None) -> bool:
    """Heuristic: option order actions are BUY_OPEN / SELL_CLOSE / etc.
    Stock actions are BUY / SELL."""
    if not action:
        return False
    a = action.upper()
    return any(k in a for k in ("OPEN", "CLOSE")) and "_" in a


def _flatten(holdings: list[dict[str, Any]]) -> dict[str, Any]:
    """Map SnapTrade's per-account holdings into a UI-friendly shape."""
    out_accounts: list[dict[str, Any]] = []
    stocks: list[dict[str, Any]] = []
    options: list[dict[str, Any]] = []
    orders: list[dict[str, Any]] = []
    total_value = 0.0
    total_cash = 0.0
    total_pl = 0.0

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
        tv_raw = float(_safe_get(entry.get("total_value"), "value") or 0)
        total_cash += bal_cash

        for p in entry.get("positions") or []:
            if not isinstance(p, dict):
                continue
            sym = p.get("symbol") or {}
            ticker = _ticker_of(sym)
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
            # SnapTrade quirk: `price` is per-share (current premium), but
            # `average_purchase_price` is the per-contract dollar cost
            # (i.e. already × the 100-share multiplier). So we apply the
            # multiplier to current value only, not to cost.
            price = float(op.get("price") or 0)
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
        # computed value is more accurate.
        computed_equity = bal_cash + acct_invested
        acct_equity = tv_raw if tv_raw >= computed_equity - 0.01 else computed_equity
        total_value += acct_equity

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
            }
        )

    cost_basis = sum((s["quantity"] * s["avg_cost"]) for s in stocks if s.get("avg_cost")) + sum(
        (op["quantity"] * (op["avg_cost"] or 0) * 100) for op in options if op.get("avg_cost")
    )
    invested = sum(s["market_value"] for s in stocks) + sum(op["market_value"] for op in options)
    equity = total_value or (total_cash + invested)

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
    for p in flat["positions"]:
        t = p.get("ticker") or "—"
        stock_groups[t] = stock_groups.get(t, 0.0) + (p.get("market_value") or 0)
        if t not in stock_descs:
            stock_descs[t] = p.get("description")
    consolidated_stocks = [
        {
            "ticker": t,
            "description": stock_descs.get(t),
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


@router.get("/holdings")
def get_holdings(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        user = snaptrade_svc.get_or_create_user(db)
        raw = snaptrade_svc.all_holdings(user)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SnapTrade error: {e}") from e
    flat = _flatten(raw)
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
        return _consolidate_for_guest(flat)

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
def sync_to_watchlist(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Manual trigger of the same auto-sync that runs on every /holdings call.
    Kept as a POST for users who want to force a fresh sync after trading."""
    try:
        user = snaptrade_svc.get_or_create_user(db)
        raw = snaptrade_svc.all_holdings(user)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SnapTrade error: {e}") from e

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
