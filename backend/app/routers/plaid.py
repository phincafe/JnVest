from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import PlaidItem
from ..services import plaid_svc

router = APIRouter(prefix="/plaid", tags=["plaid"])


class ExchangePayload(BaseModel):
    public_token: str
    institution_name: str | None = None
    institution_id: str | None = None


class ItemOut(BaseModel):
    id: int
    item_id: str
    institution_id: str | None
    institution_name: str | None
    created_at: str


@router.get("/link-token")
def link_token() -> dict[str, str]:
    try:
        token = plaid_svc.create_link_token()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plaid error: {e}") from e
    return {"link_token": token}


@router.post("/exchange", response_model=ItemOut)
def exchange(payload: ExchangePayload, db: Session = Depends(get_db)) -> ItemOut:
    try:
        result = plaid_svc.exchange_public_token(payload.public_token)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Plaid error: {e}") from e
    row = PlaidItem(
        item_id=result["item_id"],
        access_token=result["access_token"],
        institution_id=payload.institution_id,
        institution_name=payload.institution_name,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ItemOut(
        id=row.id,
        item_id=row.item_id,
        institution_id=row.institution_id,
        institution_name=row.institution_name,
        created_at=row.created_at.isoformat(),
    )


@router.get("/items", response_model=list[ItemOut])
def list_items(db: Session = Depends(get_db)) -> list[ItemOut]:
    rows = db.query(PlaidItem).order_by(PlaidItem.created_at.desc()).all()
    return [
        ItemOut(
            id=r.id,
            item_id=r.item_id,
            institution_id=r.institution_id,
            institution_name=r.institution_name,
            created_at=r.created_at.isoformat(),
        )
        for r in rows
    ]


@router.delete("/items/{item_pk}")
def delete_item(item_pk: int, db: Session = Depends(get_db)) -> dict[str, bool]:
    row = db.query(PlaidItem).filter(PlaidItem.id == item_pk).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    try:
        plaid_svc.remove_item(row.access_token)
    except Exception:
        # Even if Plaid fails to revoke, we still drop our local record.
        pass
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/holdings")
def holdings(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Aggregated holdings across all connected Plaid items.

    Returns:
        {
          "items": [{institution_name, holdings: [...], accounts: [...]}],
          "totals": {market_value, cost_basis, unrealized_pl, unrealized_pl_pct}
        }
    """
    rows = db.query(PlaidItem).all()
    items_out = []
    total_value = 0.0
    total_cost = 0.0
    for r in rows:
        try:
            data = plaid_svc.get_holdings(r.access_token)
        except Exception as e:
            items_out.append(
                {
                    "id": r.id,
                    "institution_name": r.institution_name,
                    "error": str(e),
                    "holdings": [],
                    "accounts": [],
                }
            )
            continue

        # Map Plaid security_id -> security details (ticker, name, type).
        sec_by_id = {s["security_id"]: s for s in data.get("securities", [])}
        acct_by_id = {a["account_id"]: a for a in data.get("accounts", [])}

        holdings_clean = []
        for h in data.get("holdings", []):
            sec = sec_by_id.get(h["security_id"], {})
            acct = acct_by_id.get(h["account_id"], {})
            qty = float(h.get("quantity") or 0)
            inst_price = float(h.get("institution_price") or 0)
            cost = float(h.get("cost_basis") or 0) if h.get("cost_basis") is not None else None
            mkt_val = float(h.get("institution_value") or (qty * inst_price))
            pl = (mkt_val - cost) if cost is not None else None
            pl_pct = ((mkt_val - cost) / cost * 100.0) if cost else None

            total_value += mkt_val
            if cost is not None:
                total_cost += cost

            holdings_clean.append(
                {
                    "ticker": sec.get("ticker_symbol"),
                    "name": sec.get("name"),
                    "type": sec.get("type"),
                    "account_name": acct.get("name") or acct.get("official_name"),
                    "account_subtype": acct.get("subtype"),
                    "quantity": qty,
                    "price": inst_price,
                    "cost_basis_per_share": cost / qty if cost and qty else None,
                    "market_value": mkt_val,
                    "cost_basis_total": cost,
                    "unrealized_pl": pl,
                    "unrealized_pl_pct": pl_pct,
                }
            )

        items_out.append(
            {
                "id": r.id,
                "institution_name": r.institution_name,
                "holdings": holdings_clean,
                "accounts": [
                    {
                        "name": a.get("name"),
                        "subtype": a.get("subtype"),
                        "balance": float((a.get("balances") or {}).get("current") or 0),
                    }
                    for a in data.get("accounts", [])
                ],
            }
        )

    pl_total = (total_value - total_cost) if total_cost else None
    pl_pct_total = (pl_total / total_cost * 100.0) if pl_total is not None and total_cost else None
    return {
        "items": items_out,
        "totals": {
            "market_value": total_value,
            "cost_basis": total_cost,
            "unrealized_pl": pl_total,
            "unrealized_pl_pct": pl_pct_total,
        },
    }
