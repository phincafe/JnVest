from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..config import get_settings
from ..services import alpaca

router = APIRouter(prefix="/orders", tags=["orders"])


class OrderPayload(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)
    side: Literal["buy", "sell"]
    qty: float = Field(gt=0)
    type: Literal["market", "limit"] = "market"
    time_in_force: Literal["day", "gtc"] = "day"
    limit_price: float | None = None


@router.post("")
async def submit(payload: OrderPayload) -> dict:
    settings = get_settings()
    if not settings.is_paper:
        raise HTTPException(
            status_code=403,
            detail="Order placement is disabled when ALPACA_BASE_URL is not paper.",
        )
    if not (settings.alpaca_api_key and settings.alpaca_api_secret):
        raise HTTPException(status_code=400, detail="Alpaca not configured")
    if payload.type == "limit" and payload.limit_price is None:
        raise HTTPException(status_code=400, detail="limit_price required for limit orders")

    body = {
        "symbol": payload.symbol.upper(),
        "qty": str(payload.qty),
        "side": payload.side,
        "type": payload.type,
        "time_in_force": payload.time_in_force,
    }
    if payload.type == "limit":
        body["limit_price"] = str(payload.limit_price)

    try:
        result = await alpaca.submit_order(body)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e
    return result
