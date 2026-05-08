from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import ManualPosition
from ..services import alpaca

router = APIRouter(prefix="/positions", tags=["positions"])


class ManualPositionIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)
    position_type: str = Field(pattern="^(stock|call|put)$")
    entry_price: float = Field(gt=0)
    quantity: float
    expiration: str | None = None  # YYYY-MM-DD for options
    strike: float | None = None
    notes: str | None = None


class ManualPositionOut(BaseModel):
    id: int
    symbol: str
    position_type: str
    entry_price: float
    quantity: float
    expiration: str | None
    strike: float | None
    notes: str | None
    created_at: datetime
    last_price: float | None = None
    pl: float | None = None
    pl_pct: float | None = None


@router.get("/account")
async def account() -> dict[str, Any]:
    settings = get_settings()
    if not (settings.alpaca_api_key and settings.alpaca_api_secret):
        raise HTTPException(status_code=400, detail="Alpaca not configured")
    try:
        a = await alpaca.get_account()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e
    return {
        "equity": float(a.get("equity", 0)),
        "last_equity": float(a.get("last_equity", 0)),
        "cash": float(a.get("cash", 0)),
        "buying_power": float(a.get("buying_power", 0)),
        "long_market_value": float(a.get("long_market_value", 0)),
        "short_market_value": float(a.get("short_market_value", 0)),
        "today_pl": float(a.get("equity", 0)) - float(a.get("last_equity", 0)),
        "today_pl_pct": (
            (float(a.get("equity", 0)) - float(a.get("last_equity", 0)))
            / float(a.get("last_equity", 1))
            * 100
            if float(a.get("last_equity", 0))
            else 0
        ),
        "is_paper": settings.is_paper,
    }


@router.get("/alpaca")
async def alpaca_positions() -> dict[str, Any]:
    try:
        rows = await alpaca.get_positions()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e
    return {
        "positions": [
            {
                "symbol": r.get("symbol"),
                "asset_class": r.get("asset_class"),
                "qty": float(r.get("qty", 0)),
                "side": r.get("side"),
                "avg_entry_price": float(r.get("avg_entry_price", 0)),
                "market_value": float(r.get("market_value", 0)),
                "current_price": float(r.get("current_price", 0)),
                "unrealized_pl": float(r.get("unrealized_pl", 0)),
                "unrealized_plpc": float(r.get("unrealized_plpc", 0)) * 100,
                "unrealized_intraday_pl": float(r.get("unrealized_intraday_pl", 0)),
            }
            for r in rows
        ]
    }


@router.get("/orders")
async def alpaca_orders(limit: int = 20) -> dict[str, Any]:
    try:
        rows = await alpaca.get_orders(limit=limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e
    return {
        "orders": [
            {
                "id": r.get("id"),
                "symbol": r.get("symbol"),
                "side": r.get("side"),
                "qty": float(r.get("qty", 0)),
                "filled_qty": float(r.get("filled_qty", 0)),
                "type": r.get("type"),
                "limit_price": r.get("limit_price"),
                "status": r.get("status"),
                "submitted_at": r.get("submitted_at"),
                "filled_at": r.get("filled_at"),
                "filled_avg_price": r.get("filled_avg_price"),
            }
            for r in rows
        ]
    }


def _row_to_out(row: ManualPosition, last_price: float | None = None) -> ManualPositionOut:
    pl = pl_pct = None
    if last_price is not None and row.position_type == "stock":
        pl = (last_price - row.entry_price) * row.quantity
        pl_pct = ((last_price - row.entry_price) / row.entry_price) * 100
    return ManualPositionOut(
        id=row.id,
        symbol=row.symbol,
        position_type=row.position_type,
        entry_price=row.entry_price,
        quantity=row.quantity,
        expiration=row.expiration,
        strike=row.strike,
        notes=row.notes,
        created_at=row.created_at,
        last_price=last_price,
        pl=pl,
        pl_pct=pl_pct,
    )


@router.get("/manual", response_model=list[ManualPositionOut])
async def list_manual(db: Session = Depends(get_db)) -> list[ManualPositionOut]:
    rows = db.query(ManualPosition).order_by(ManualPosition.created_at.desc()).all()
    if not rows:
        return []
    stock_syms = sorted({r.symbol for r in rows if r.position_type == "stock"})
    prices: dict[str, float] = {}
    if stock_syms:
        try:
            trades = await alpaca.latest_trades(stock_syms)
            prices = {s: float(t.get("p", 0)) for s, t in trades.items()}
        except Exception:
            prices = {}
    return [_row_to_out(r, prices.get(r.symbol)) for r in rows]


@router.post("/manual", response_model=ManualPositionOut)
def create_manual(payload: ManualPositionIn, db: Session = Depends(get_db)) -> ManualPositionOut:
    row = ManualPosition(
        symbol=payload.symbol.upper(),
        position_type=payload.position_type,
        entry_price=payload.entry_price,
        quantity=payload.quantity,
        expiration=payload.expiration,
        strike=payload.strike,
        notes=payload.notes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_to_out(row)


@router.delete("/manual/{position_id}")
def delete_manual(position_id: int, db: Session = Depends(get_db)) -> dict[str, bool]:
    n = db.query(ManualPosition).filter(ManualPosition.id == position_id).delete()
    db.commit()
    if not n:
        raise HTTPException(status_code=404, detail="not found")
    return {"ok": True}
