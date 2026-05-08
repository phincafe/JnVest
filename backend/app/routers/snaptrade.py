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
        acct_id = acct.get("id")
        acct_name = acct.get("name") or acct.get("number") or "Account"
        broker = (acct.get("institution_name") or "") if isinstance(acct, dict) else ""
        balances = entry.get("balances") or []
        bal_total = 0.0
        bal_cash = 0.0
        for b in balances:
            cur = (b.get("currency") or {}).get("code") if isinstance(b, dict) else None
            if cur and cur != "USD":
                continue
            bal_total += float(b.get("buying_power") or 0)
            bal_cash += float(b.get("cash") or 0)
        # SDK also reports total_value sometimes
        tv = (
            float(entry.get("total_value", {}).get("value") or 0)
            if isinstance(entry.get("total_value"), dict)
            else 0
        )
        total_value += tv or bal_total
        total_cash += bal_cash

        for p in entry.get("positions") or []:
            sym = p.get("symbol") or {}
            inner_sym = sym.get("symbol") or {}
            ticker = (
                inner_sym.get("symbol") or sym.get("symbol")
                if isinstance(inner_sym, dict)
                else None
            )
            ticker = (
                ticker
                if isinstance(ticker, str)
                else (sym.get("symbol") if isinstance(sym.get("symbol"), str) else None)
            )
            description = (
                inner_sym.get("description") if isinstance(inner_sym, dict) else None
            ) or sym.get("description")
            qty = float(p.get("units") or 0)
            price = float(p.get("price") or 0)
            avg = (
                float(p.get("average_purchase_price") or 0)
                if p.get("average_purchase_price")
                else None
            )
            mkt_val = qty * price
            cost = (qty * avg) if avg else None
            pl = (mkt_val - cost) if cost is not None else float(p.get("open_pnl") or 0) or None
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
            sym = op.get("symbol") or {}
            opt_sym = sym.get("option_symbol") or {}
            underlying = (
                (opt_sym.get("underlying_symbol") or {}).get("symbol")
                if isinstance(opt_sym, dict)
                else None
            )
            qty = float(op.get("units") or 0)
            price = float(op.get("price") or 0) if op.get("price") else 0
            avg = (
                float(op.get("average_purchase_price") or 0)
                if op.get("average_purchase_price")
                else None
            )
            multiplier = 100.0  # standard equity option
            mkt_val = qty * price * multiplier
            cost = (qty * avg * multiplier) if avg else None
            pl = (mkt_val - cost) if cost is not None else None
            pl_pct = ((mkt_val - cost) / cost * 100.0) if cost else None
            if pl is not None:
                total_pl += pl
            options.append(
                {
                    "account_id": acct_id,
                    "account": acct_name,
                    "broker": broker,
                    "underlying": underlying,
                    "ticker": opt_sym.get("ticker") if isinstance(opt_sym, dict) else None,
                    "option_type": (
                        opt_sym.get("option_type") if isinstance(opt_sym, dict) else None
                    ),
                    "strike": opt_sym.get("strike_price") if isinstance(opt_sym, dict) else None,
                    "expiration": (
                        opt_sym.get("expiration_date") if isinstance(opt_sym, dict) else None
                    ),
                    "quantity": qty,
                    "price": price,
                    "avg_cost": avg,
                    "market_value": mkt_val,
                    "unrealized_pl": pl,
                    "unrealized_pl_pct": pl_pct,
                }
            )

        for o in entry.get("orders") or []:
            sym = o.get("symbol") or {}
            inner = sym.get("symbol") if isinstance(sym, dict) else None
            ticker = (
                inner.get("symbol")
                if isinstance(inner, dict)
                else (sym.get("symbol") if isinstance(sym.get("symbol"), str) else None)
            )
            orders.append(
                {
                    "account": acct_name,
                    "broker": broker,
                    "ticker": ticker,
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
                "type": (
                    acct.get("meta", {}).get("type") if isinstance(acct.get("meta"), dict) else None
                ),
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
