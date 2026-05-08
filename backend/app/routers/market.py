from typing import Any

from fastapi import APIRouter, HTTPException

from ..services import alpaca, finnhub

router = APIRouter(prefix="/market", tags=["market"])

INDEX_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"]
MACRO_SYMBOLS = ["VIXY", "UUP"]  # IEX-tradable proxies; native ^VIX/^TNX/DXY are off-feed
SECTOR_SYMBOLS = [
    "XLK",
    "XLF",
    "XLV",
    "XLY",
    "XLP",
    "XLE",
    "XLI",
    "XLB",
    "XLU",
    "XLRE",
    "XLC",
]


def _quote_tile(symbol: str, trade: dict[str, Any], bars: list[dict[str, Any]]) -> dict[str, Any]:
    last = float(trade.get("p", 0)) if trade else 0.0
    prev_close = (
        float(bars[-2]["c"]) if len(bars) >= 2 else (float(bars[-1]["c"]) if bars else last)
    )
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
    tiles = [_quote_tile(sym, trades.get(sym, {}), bars.get(sym, [])) for sym in INDEX_SYMBOLS]
    return {"tiles": tiles}


@router.get("/sectors")
async def sectors() -> dict[str, Any]:
    try:
        trades = await alpaca.latest_trades(SECTOR_SYMBOLS)
        bars = await alpaca.daily_bars(SECTOR_SYMBOLS, days=5)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e
    tiles = [_quote_tile(sym, trades.get(sym, {}), bars.get(sym, [])) for sym in SECTOR_SYMBOLS]
    return {"tiles": tiles}


_MOVERS_UNIVERSE = [
    # Liquid mega-caps + popular options names — keeps the call to ~50 symbols.
    "AAPL",
    "MSFT",
    "GOOGL",
    "GOOG",
    "AMZN",
    "NVDA",
    "META",
    "TSLA",
    "BRK.B",
    "V",
    "JNJ",
    "WMT",
    "JPM",
    "MA",
    "PG",
    "AVGO",
    "HD",
    "CVX",
    "MRK",
    "ABBV",
    "PEP",
    "KO",
    "BAC",
    "PFE",
    "TMO",
    "COST",
    "DIS",
    "ABT",
    "CSCO",
    "ACN",
    "MCD",
    "DHR",
    "ADBE",
    "VZ",
    "CRM",
    "WFC",
    "AMD",
    "NFLX",
    "INTC",
    "QCOM",
    "ORCL",
    "PYPL",
    "T",
    "CMCSA",
    "NKE",
    "COIN",
    "PLTR",
    "SOFI",
    "RIVN",
    "RBLX",
]


@router.get("/movers")
async def movers(limit: int = 5) -> dict[str, Any]:
    """Top gainers + losers across a curated universe of liquid mega-caps and
    popular options names — Finviz-style 'top of the morning' panel."""
    try:
        trades = await alpaca.latest_trades(_MOVERS_UNIVERSE)
        bars = await alpaca.daily_bars(_MOVERS_UNIVERSE, days=5)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e

    rows: list[dict[str, Any]] = []
    for sym in _MOVERS_UNIVERSE:
        sym_bars = bars.get(sym, [])
        trade = trades.get(sym, {})
        if not sym_bars or not trade:
            continue
        last = float(trade.get("p") or 0)
        prev_close = float(sym_bars[-2]["c"]) if len(sym_bars) >= 2 else float(sym_bars[-1]["c"])
        if not prev_close or not last:
            continue
        change = last - prev_close
        pct = change / prev_close * 100.0
        rows.append(
            {
                "symbol": sym,
                "last": last,
                "change": change,
                "change_pct": pct,
            }
        )

    rows.sort(key=lambda r: r["change_pct"], reverse=True)
    gainers = rows[:limit]
    losers = rows[-limit:][::-1]
    return {"gainers": gainers, "losers": losers}


@router.get("/news")
async def market_news(limit: int = 20) -> dict[str, Any]:
    """General market news headlines from Finnhub."""
    try:
        items = await finnhub.market_news("general", limit=limit)
    except RuntimeError as e:
        return {"items": [], "warning": str(e)}
    except Exception as e:
        return {"items": [], "warning": f"Finnhub error: {e}"}
    trimmed = [
        {
            "headline": it.get("headline"),
            "source": it.get("source"),
            "url": it.get("url"),
            "summary": (it.get("summary") or "")[:240],
            "ts": it.get("datetime"),
            "category": it.get("category"),
            "image": it.get("image"),
        }
        for it in items
    ]
    return {"items": trimmed}


@router.get("/intraday/{symbol}")
async def intraday(symbol: str, interval: str = "5Min") -> dict[str, Any]:
    """Today's intraday bars at the chosen interval (1Min / 5Min / 15Min /
    30Min / 1Hour). Used by the live index chart on the Morning tab."""
    if interval not in ("1Min", "5Min", "15Min", "30Min", "1Hour"):
        raise HTTPException(status_code=400, detail="invalid interval")
    try:
        # Pull today's bars (start = 24h ago to safely include premarket).
        from datetime import datetime, timedelta

        start = (datetime.utcnow() - timedelta(hours=36)).strftime("%Y-%m-%dT%H:%M:%SZ")
        bars = await alpaca.bars(symbol.upper(), timeframe=interval, start=start, limit=1000)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e
    return {"symbol": symbol.upper(), "interval": interval, "bars": bars}


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
