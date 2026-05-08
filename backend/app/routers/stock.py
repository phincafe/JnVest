from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..services import alpaca, finnhub, yahoo  # noqa: F401
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
    start = (datetime.utcnow() - timedelta(days=lookback_days + extra_days)).strftime("%Y-%m-%d")

    try:
        bars = await alpaca.bars(symbol.upper(), timeframe=timeframe, start=start, limit=10000)
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
    """Combined fundamentals. Prefer Finnhub (reliable) and fall back to yfinance
    when a field is missing — yfinance is frequently rate-limited from cloud IPs."""
    sym = symbol.upper()
    out: dict[str, Any] = {
        "symbol": sym,
        "next_earnings": None,
        "ex_dividend": None,
        "analyst_target_mean": None,
        "analyst_target_high": None,
        "analyst_target_low": None,
        "analyst_count": None,
        "market_cap": None,
        "trailing_pe": None,
        "forward_pe": None,
    }

    # --- Finnhub (preferred) ---
    try:
        metric = await finnhub.basic_financials(sym)
        out["market_cap"] = metric.get("marketCapitalization")
        out["trailing_pe"] = metric.get("peTTM") or metric.get("peNormalizedAnnual")
        out["forward_pe"] = metric.get("peNTM") or metric.get("peExclExtraTTM")
    except Exception:
        pass
    try:
        pt = await finnhub.price_target(sym)
        out["analyst_target_mean"] = pt.get("targetMean") or pt.get("targetMedian")
        out["analyst_target_high"] = pt.get("targetHigh")
        out["analyst_target_low"] = pt.get("targetLow")
        out["analyst_count"] = pt.get("numberOfAnalysts")
    except Exception:
        pass
    try:
        er = await finnhub.earnings_for_symbol(sym)
        if er and er.get("date"):
            out["next_earnings"] = er["date"]
    except Exception:
        pass
    try:
        profile = await finnhub.company_profile(sym)
        if profile.get("marketCapitalization") and not out["market_cap"]:
            out["market_cap"] = profile["marketCapitalization"]
    except Exception:
        pass

    # --- yfinance fallback for ex-dividend (Finnhub free tier doesn't expose it) ---
    try:
        info = await yahoo.info(sym)
        ex_div_ts = info.get("exDividendDate")
        if ex_div_ts:
            try:
                out["ex_dividend"] = datetime.utcfromtimestamp(int(ex_div_ts)).strftime("%Y-%m-%d")
            except (ValueError, TypeError, OSError):
                pass
        if not out["next_earnings"]:
            ner = await yahoo.next_earnings_date(sym)
            if ner:
                out["next_earnings"] = ner
        # Backfill any None fields from yfinance if Finnhub didn't have them
        if out["analyst_target_mean"] is None:
            out["analyst_target_mean"] = info.get("targetMeanPrice")
        if out["analyst_target_high"] is None:
            out["analyst_target_high"] = info.get("targetHighPrice")
        if out["analyst_target_low"] is None:
            out["analyst_target_low"] = info.get("targetLowPrice")
        if out["analyst_count"] is None:
            out["analyst_count"] = info.get("numberOfAnalystOpinions")
        if out["market_cap"] is None:
            out["market_cap"] = info.get("marketCap")
        if out["trailing_pe"] is None:
            out["trailing_pe"] = info.get("trailingPE")
        if out["forward_pe"] is None:
            out["forward_pe"] = info.get("forwardPE")
    except Exception:
        pass

    return out
