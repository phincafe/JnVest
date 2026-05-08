from typing import Any

from fastapi import APIRouter, HTTPException

from ..services import alpaca

router = APIRouter(prefix="/market", tags=["market"])

INDEX_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"]
MACRO_SYMBOLS = ["VIXY", "UUP"]  # IEX-tradable proxies; native ^VIX/^TNX/DXY are off-feed
SECTOR_SYMBOLS = [
    "XLK", "XLF", "XLV", "XLY", "XLP", "XLE", "XLI", "XLB", "XLU", "XLRE", "XLC",
]


def _quote_tile(symbol: str, trade: dict[str, Any], bars: list[dict[str, Any]]) -> dict[str, Any]:
    last = float(trade.get("p", 0)) if trade else 0.0
    prev_close = float(bars[-2]["c"]) if len(bars) >= 2 else (float(bars[-1]["c"]) if bars else last)
    change = last - prev_close
    pct = (change / prev_close * 100.0) if prev_close else 0.0
    return {
        "symbol": symbol,
        "last": last,
        "prev_close": prev_close,
        "change": change,
        "change_pct": pct,
        "ts": trade.get("t") if trade else None,
    }


@router.get("/indices")
async def indices() -> dict[str, Any]:
    try:
        trades = await alpaca.latest_trades(INDEX_SYMBOLS)
        bars = await alpaca.daily_bars(INDEX_SYMBOLS, days=5)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e
    tiles = [
        _quote_tile(sym, trades.get(sym, {}), bars.get(sym, []))
        for sym in INDEX_SYMBOLS
    ]
    return {"tiles": tiles}


@router.get("/sectors")
async def sectors() -> dict[str, Any]:
    try:
        trades = await alpaca.latest_trades(SECTOR_SYMBOLS)
        bars = await alpaca.daily_bars(SECTOR_SYMBOLS, days=5)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e
    tiles = [
        _quote_tile(sym, trades.get(sym, {}), bars.get(sym, []))
        for sym in SECTOR_SYMBOLS
    ]
    return {"tiles": tiles}


@router.get("/macro")
async def macro() -> dict[str, Any]:
    """VIXY (vol proxy) + UUP (dollar proxy). Native ^VIX/^TNX/DXY require yfinance."""
    try:
        trades = await alpaca.latest_trades(MACRO_SYMBOLS)
        bars = await alpaca.daily_bars(MACRO_SYMBOLS, days=35)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e
    out = {}
    for sym in MACRO_SYMBOLS:
        sym_bars = bars.get(sym, [])
        out[sym] = {
            **_quote_tile(sym, trades.get(sym, {}), sym_bars),
            "spark": [b["c"] for b in sym_bars[-30:]],
        }
    return out
