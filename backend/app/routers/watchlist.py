from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import WatchlistTicker
from ..services import alpaca, streamer, yahoo
from ..services.indicators import rsi, sma

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


class TickerIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)


class TickerOut(BaseModel):
    id: int
    symbol: str
    sort_order: int


@router.get("", response_model=list[TickerOut])
def list_tickers(db: Session = Depends(get_db)) -> list[TickerOut]:
    rows = db.query(WatchlistTicker).order_by(WatchlistTicker.sort_order).all()
    return [TickerOut(id=r.id, symbol=r.symbol, sort_order=r.sort_order) for r in rows]


@router.post("", response_model=TickerOut)
def add_ticker(payload: TickerIn, db: Session = Depends(get_db)) -> TickerOut:
    sym = payload.symbol.strip().upper()
    existing = db.query(WatchlistTicker).filter(WatchlistTicker.symbol == sym).first()
    if existing:
        return TickerOut(id=existing.id, symbol=existing.symbol, sort_order=existing.sort_order)
    next_order = (
        db.query(WatchlistTicker).order_by(WatchlistTicker.sort_order.desc()).first()
    )
    sort_order = (next_order.sort_order + 1) if next_order else 0
    row = WatchlistTicker(symbol=sym, sort_order=sort_order)
    db.add(row)
    db.commit()
    db.refresh(row)
    streamer.notify_watchlist_changed()
    return TickerOut(id=row.id, symbol=row.symbol, sort_order=row.sort_order)


@router.delete("/{symbol}")
def remove_ticker(symbol: str, db: Session = Depends(get_db)) -> dict[str, bool]:
    sym = symbol.strip().upper()
    deleted = db.query(WatchlistTicker).filter(WatchlistTicker.symbol == sym).delete()
    db.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="not in watchlist")
    streamer.notify_watchlist_changed()
    return {"ok": True}


def _enrich(symbol: str, bars: list[dict[str, Any]], trade: dict[str, Any]) -> dict[str, Any]:
    closes = [b["c"] for b in bars]
    last = float(trade.get("p", 0)) if trade else (closes[-1] if closes else 0.0)
    prev_close = closes[-2] if len(closes) >= 2 else (closes[-1] if closes else last)
    change = last - prev_close
    pct = (change / prev_close * 100.0) if prev_close else 0.0

    sma20 = sma(closes, 20)[-1] if len(closes) >= 20 else None
    sma50 = sma(closes, 50)[-1] if len(closes) >= 50 else None
    sma200 = sma(closes, 200)[-1] if len(closes) >= 200 else None
    rsi14 = rsi(closes, 14)[-1] if len(closes) >= 15 else None

    high_52w = max(closes[-252:]) if closes else None
    low_52w = min(closes[-252:]) if closes else None

    vol = float(bars[-1]["v"]) if bars else 0.0
    avg_vol_30 = (
        sum(b["v"] for b in bars[-30:]) / min(30, len(bars[-30:])) if bars else 0.0
    )

    return {
        "symbol": symbol,
        "last": last,
        "prev_close": prev_close,
        "change": change,
        "change_pct": pct,
        "volume": vol,
        "avg_volume_30d": avg_vol_30,
        "rel_volume": (vol / avg_vol_30) if avg_vol_30 else None,
        "sma20": sma20,
        "sma50": sma50,
        "sma200": sma200,
        "rsi14": rsi14,
        "high_52w": high_52w,
        "low_52w": low_52w,
    }


@router.get("/quotes")
async def watchlist_quotes(db: Session = Depends(get_db)) -> dict[str, Any]:
    rows = db.query(WatchlistTicker).order_by(WatchlistTicker.sort_order).all()
    symbols = [r.symbol for r in rows]
    if not symbols:
        return {"rows": []}
    try:
        bars_all = await alpaca.daily_bars(symbols, days=260)
        trades = await alpaca.latest_trades(symbols)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e

    out: list[dict[str, Any]] = []
    for sym in symbols:
        out.append(_enrich(sym, bars_all.get(sym, []), trades.get(sym, {})))

    # Earnings badges (yfinance — best effort, don't fail the response if it errors).
    today = datetime.utcnow().date()
    for row in out:
        try:
            d_str = await yahoo.next_earnings_date(row["symbol"])
            if d_str:
                d = datetime.strptime(d_str, "%Y-%m-%d").date()
                row["next_earnings"] = d_str
                row["earnings_in_days"] = (d - today).days
            else:
                row["next_earnings"] = None
                row["earnings_in_days"] = None
        except Exception:
            row["next_earnings"] = None
            row["earnings_in_days"] = None

    return {"rows": out}
