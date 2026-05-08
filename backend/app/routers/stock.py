from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..services import alpaca, finnhub, yahoo
from ..services.indicators import sma

router = APIRouter(prefix="/stock", tags=["stock"])


# Range -> (alpaca timeframe, lookback days, target bar count)
RANGE_MAP: dict[str, tuple[str, int]] = {
    "1D": ("5Min", 1),
    "5D": ("15Min", 5),
    "1M": ("1Hour", 30),
    "6M": ("1Day", 200),
    "1Y": ("1Day", 365),
}


@router.get("/{symbol}/bars")
async def stock_bars(symbol: str, range: str = Query("1M")) -> dict[str, Any]:
    rng = range.upper()
    if rng not in RANGE_MAP:
        raise HTTPException(status_code=400, detail=f"unknown range '{range}'")
    timeframe, lookback_days = RANGE_MAP[rng]

    # For SMAs to be meaningful we need at least 200 prior closes; pull extra
    # for daily ranges. For intraday ranges we just show in-view SMAs.
    extra_days = 0 if "Day" not in timeframe else 250
    start = (datetime.utcnow() - timedelta(days=lookback_days + extra_days)).strftime(
        "%Y-%m-%d"
    )

    try:
        bars = await alpaca.bars(
            symbol.upper(), timeframe=timeframe, start=start, limit=10000
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}") from e

    closes = [b["c"] for b in bars]
    sma20 = sma(closes, 20)
    sma50 = sma(closes, 50)
    sma200 = sma(closes, 200)

    # Trim head padding: keep only the requested window for display, but keep SMAs aligned.
    if "Day" in timeframe and extra_days:
        cutoff = datetime.utcnow() - timedelta(days=lookback_days)
        cutoff_iso = cutoff.replace(microsecond=0).isoformat() + "Z"
        # bars["t"] is RFC3339 like "2024-09-01T00:00:00Z"; lexical compare works.
        keep_idx = [i for i, b in enumerate(bars) if b["t"] >= cutoff_iso]
        if keep_idx:
            start_i = keep_idx[0]
            bars = bars[start_i:]
            sma20 = sma20[start_i:]
            sma50 = sma50[start_i:]
            sma200 = sma200[start_i:]

    return {
        "symbol": symbol.upper(),
        "range": rng,
        "timeframe": timeframe,
        "bars": bars,
        "sma20": sma20,
        "sma50": sma50,
        "sma200": sma200,
    }


@router.get("/{symbol}/news")
async def stock_news(symbol: str, limit: int = 10) -> dict[str, Any]:
    try:
        items = await finnhub.company_news(symbol.upper())
    except RuntimeError as e:
        # FINNHUB_API_KEY missing — surface nicely instead of 500.
        return {"items": [], "warning": str(e)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Finnhub error: {e}") from e

    trimmed = []
    for it in items[:limit]:
        trimmed.append(
            {
                "headline": it.get("headline"),
                "source": it.get("source"),
                "url": it.get("url"),
                "summary": (it.get("summary") or "")[:280],
                "ts": it.get("datetime"),
            }
        )
    return {"items": trimmed}


@router.get("/{symbol}/fundamentals")
async def stock_fundamentals(symbol: str) -> dict[str, Any]:
    info = await yahoo.info(symbol.upper())
    next_er = await yahoo.next_earnings_date(symbol.upper())
    ex_div_ts = info.get("exDividendDate")
    ex_div: str | None = None
    if ex_div_ts:
        try:
            ex_div = datetime.utcfromtimestamp(int(ex_div_ts)).strftime("%Y-%m-%d")
        except (ValueError, TypeError, OSError):
            ex_div = None

    return {
        "symbol": symbol.upper(),
        "next_earnings": next_er,
        "ex_dividend": ex_div,
        "analyst_target_mean": info.get("targetMeanPrice"),
        "analyst_target_high": info.get("targetHighPrice"),
        "analyst_target_low": info.get("targetLowPrice"),
        "analyst_count": info.get("numberOfAnalystOpinions"),
        "market_cap": info.get("marketCap"),
        "trailing_pe": info.get("trailingPE"),
        "forward_pe": info.get("forwardPE"),
    }
