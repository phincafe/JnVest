from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..services import snaptrade_svc

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
            return cur
        if isinstance(cur, dict):
            cur = cur.get("symbol")
            continue
        return None
    return None


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
        tv = float(_safe_get(entry.get("total_value"), "value") or 0)
        total_value += tv or bal_total
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
            orders.append(
                {
                    "account": acct_name,
                    "broker": broker,
                    "ticker": _ticker_of(o.get("symbol")),
                    "action": o.get("action"),
                    "status": o.get("status"),
                    "total_quantity": o.get("total_quantity"),
                    "filled_quantity": o.get("filled_quantity"),
                    "execution_price": o.get("execution_price"),
                    "time_executed": o.get("time_executed") or o.get("time_placed"),
                }
            )

        out_accounts.append(
            {
                "id": acct_id,
                "name": acct_name,
                "broker": broker,
                "type": _safe_get(_safe_get(acct, "meta"), "type"),
                "balance": bal_total or tv,
                "cash": bal_cash,
            }
        )

    return {
        "accounts": out_accounts,
        "positions": stocks,
        "options": options,
        "orders": orders[:50],
        "totals": {
            "market_value": total_value,
            "cash": total_cash,
            "unrealized_pl": total_pl,
        },
    }


@router.get("/holdings")
def get_holdings(db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        user = snaptrade_svc.get_or_create_user(db)
        raw = snaptrade_svc.all_holdings(user)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SnapTrade error: {e}") from e
    return _flatten(raw)
