import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException

from ..services import alpaca, apewisdom, finnhub

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


# Friendly names for the sector rotation widget — the ETF tickers are
# meaningless to anyone not glued to ETF.com.
SECTOR_NAMES = {
    "XLK": "Technology",
    "XLF": "Financials",
    "XLV": "Healthcare",
    "XLY": "Consumer Discretionary",
    "XLP": "Consumer Staples",
    "XLE": "Energy",
    "XLI": "Industrials",
    "XLB": "Materials",
    "XLU": "Utilities",
    "XLRE": "Real Estate",
    "XLC": "Communications",
}


def _pct_back(bars: list[dict[str, Any]], last: float, n: int) -> float | None:
    """% change from the close `n` trading days back to `last`. None if we
    don't have enough history or the baseline is unusable."""
    if len(bars) < n + 1 or last <= 0:
        return None
    base = float(bars[-(n + 1)].get("c") or 0)
    if base <= 0:
        return None
    return (last - base) / base * 100.0


@router.get("/sector-rotation")
async def sector_rotation() -> dict[str, Any]:
    """For each sector ETF, % change over 1D / 5D / 1M / 3M. The *spread*
    between sectors and the change-of-rank between timeframes IS the rotation
    signal — strong recent vs weak longer-term means money is rotating IN."""
    try:
        trades = await alpaca.latest_trades(SECTOR_SYMBOLS)
        # Need ~75 trading days for 3M lookback (≈63) with buffer.
        bars = await alpaca.daily_bars(SECTOR_SYMBOLS, days=140)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e

    out: list[dict[str, Any]] = []
    for sym in SECTOR_SYMBOLS:
        sym_bars = bars.get(sym) or []
        trade = trades.get(sym, {})
        last = float(trade.get("p") or 0) or (
            float(sym_bars[-1].get("c") or 0) if sym_bars else 0.0
        )
        prev_close = float(sym_bars[-2]["c"]) if len(sym_bars) >= 2 else (last if last else 0)

        d1 = ((last - prev_close) / prev_close * 100.0) if prev_close > 0 else None
        d5 = _pct_back(sym_bars, last, 5)
        m1 = _pct_back(sym_bars, last, 21)
        m3 = _pct_back(sym_bars, last, 63)

        out.append(
            {
                "symbol": sym,
                "name": SECTOR_NAMES.get(sym, sym),
                "last": last,
                "change_1d_pct": d1,
                "change_5d_pct": d5,
                "change_1m_pct": m1,
                "change_3m_pct": m3,
                # Rotation score: short-term outperformance vs longer-term.
                # Positive = sector improving (money rotating IN);
                # negative = sector decelerating (money rotating OUT).
                "rotation_score": ((m1 - m3) if (m1 is not None and m3 is not None) else None),
            }
        )

    # Default order: best rotation score first (money flowing IN). Frontend
    # can re-sort by any column.
    out.sort(
        key=lambda x: x.get("rotation_score") if x.get("rotation_score") is not None else -1e9,
        reverse=True,
    )
    return {"sectors": out}


@router.get("/wsb")
async def wsb(limit: int = 10) -> dict[str, Any]:
    """Top WallStreetBets tickers by mention count, with 24h delta + rank
    change + sentiment. Public — no auth needed (Reddit data, scraped via
    ApeWisdom). Cached server-side 15 min."""
    try:
        items = await apewisdom.trending(filter_name="wallstreetbets", limit=limit)
    except Exception as e:
        return {"items": [], "warning": f"ApeWisdom error: {e}"}
    return {"items": items}


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


@router.get("/search")
async def search(q: str, limit: int = 10) -> dict[str, Any]:
    """Symbol search for the cmd+K palette autocomplete. Public (no auth)
    so guests can look up tickers that aren't in the owner's watchlist."""
    q = (q or "").strip()
    if not q:
        return {"results": []}
    try:
        results = await finnhub.search_symbols(q, limit=limit)
    except RuntimeError as e:
        return {"results": [], "warning": str(e)}
    except Exception as e:
        return {"results": [], "warning": f"Finnhub error: {e}"}
    return {"results": results}


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
    """Today's intraday bars at the chosen interval. Returns prev_close (last
    trading day's daily close) so the frontend can compute % change the way
    Yahoo/Robinhood do — vs prior session, not vs today's first bar."""
    if interval not in ("1Min", "5Min", "15Min", "30Min", "1Hour"):
        raise HTTPException(status_code=400, detail="invalid interval")
    from datetime import datetime, timedelta

    sym = symbol.upper()
    # Tight window: today's premarket through now. ~14h covers pre-open
    # (4 AM ET) through after-hours (8 PM ET) on any timezone.
    # Round `start` down to the nearest minute so the upstream `bars()` cache
    # key is stable for ~60s. Without this, microsecond precision was making
    # every request a cache miss (the actual cause of "chart loading slow").
    now_minute = datetime.utcnow().replace(second=0, microsecond=0)
    start = (now_minute - timedelta(hours=14)).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        bars, daily = await asyncio.gather(
            alpaca.bars(sym, timeframe=interval, start=start, limit=1000),
            alpaca.daily_bars([sym], days=5),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e

    # prev_close = the most recent daily bar that isn't "today" (yesterday's
    # close for typical M-F, Friday's close on Mon, etc.).
    prev_close: float | None = None
    sym_dailies = (daily or {}).get(sym, [])
    today_iso = datetime.utcnow().strftime("%Y-%m-%d")
    for b in reversed(sym_dailies):
        when = (b.get("t") or "")[:10]
        if when and when < today_iso:
            prev_close = float(b.get("c") or 0) or None
            break
    if prev_close is None and sym_dailies:
        prev_close = float(sym_dailies[-1].get("c") or 0) or None

    return {
        "symbol": sym,
        "interval": interval,
        "bars": bars,
        "prev_close": prev_close,
    }


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
