from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..services import alpaca, finnhub, yahoo  # noqa: F401
from ..services.indicators import sma

router = APIRouter(prefix="/stock", tags=["stock"])


# Calendar days to look back per range. Independent of timeframe so that
# (range, timeframe) can vary independently — e.g. you can view 1Y of 1Hour
# bars OR 1Y of 1Day bars; the user picks what makes sense for them.
RANGE_DAYS: dict[str, int] = {
    "1D": 1,
    "5D": 5,
    "1M": 30,
    "3M": 90,
    "6M": 200,
    "1Y": 365,
    "5Y": 365 * 5,
    # Alpaca's IEX daily history goes back ~5+ years for most names; ask for
    # 15y so we get everything available without paging.
    "ALL": 365 * 15,
}

# Allowed timeframes per range. The first entry is the default when caller
# doesn't specify a timeframe. Combos that would return millions of bars
# (e.g. 1Min over 1Y) are simply not listed → rejected at the API layer.
RANGE_TIMEFRAMES: dict[str, list[str]] = {
    "1D": ["5Min", "1Min", "15Min", "30Min", "1Hour"],
    "5D": ["15Min", "5Min", "30Min", "1Hour"],
    "1M": ["1Hour", "30Min", "1Day"],
    "3M": ["1Hour", "1Day"],
    "6M": ["1Day", "1Hour"],
    "1Y": ["1Day", "1Week"],
    "5Y": ["1Week", "1Day"],
    "ALL": ["1Day", "1Week", "1Month"],
}


@router.get("/{symbol}/bars/timeframes")
async def stock_bars_timeframes() -> dict[str, list[str]]:
    """Allowed (range → timeframes) so the frontend can render valid pickers
    without hard-coding the same combos."""
    return RANGE_TIMEFRAMES


@router.get("/{symbol}/bars")
async def stock_bars(
    symbol: str,
    range: str = Query("1M"),
    timeframe: str | None = Query(None),
) -> dict[str, Any]:
    rng = range.upper()
    if rng not in RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"unknown range '{range}'")
    allowed_tfs = RANGE_TIMEFRAMES[rng]
    if timeframe is None:
        timeframe = allowed_tfs[0]
    if timeframe not in allowed_tfs:
        raise HTTPException(
            status_code=400,
            detail=f"timeframe '{timeframe}' not allowed for range '{rng}'. "
            f"Valid: {', '.join(allowed_tfs)}",
        )
    lookback_days = RANGE_DAYS[rng]

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
async def stock_news(symbol: str, limit: int = 10, days_back: int = 30) -> dict[str, Any]:
    try:
        items = await finnhub.company_news(symbol.upper(), days_back=days_back)
    except RuntimeError as e:
        # FINNHUB_API_KEY missing — surface nicely instead of 500.
        return {"items": [], "warning": str(e), "days_back": days_back}
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
    return {"items": trimmed, "days_back": days_back}


@router.get("/{symbol}/insider")
async def stock_insider(symbol: str) -> dict[str, Any]:
    """Last 90 days of Form 4 insider transactions, plus a buy/sell summary."""
    sym = symbol.upper()
    try:
        rows = await finnhub.insider_transactions(sym)
    except RuntimeError as e:
        return {"items": [], "summary": None, "warning": str(e)}
    except Exception as e:
        return {"items": [], "summary": None, "warning": f"Finnhub error: {e}"}

    items = []
    buy_shares = sell_shares = 0.0
    buy_value = sell_value = 0.0
    for r in rows:
        change = float(r.get("change") or 0)
        share_value = float(r.get("share") or 0) * float(r.get("transactionPrice") or 0)
        if change > 0:
            buy_shares += change
            buy_value += abs(share_value)
        elif change < 0:
            sell_shares += abs(change)
            sell_value += abs(share_value)
        items.append(
            {
                "name": r.get("name"),
                "share": float(r.get("share") or 0),
                "change": change,
                "transaction_price": float(r.get("transactionPrice") or 0),
                "transaction_code": r.get("transactionCode"),
                "transaction_date": r.get("transactionDate"),
                "filing_date": r.get("filingDate"),
            }
        )
    summary = (
        {
            "buy_shares": buy_shares,
            "sell_shares": sell_shares,
            "buy_value": buy_value,
            "sell_value": sell_value,
            "net_shares": buy_shares - sell_shares,
        }
        if items
        else None
    )
    return {"items": items, "summary": summary}


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
        "analyst_recommendation": None,  # latest period buy/hold/sell breakdown
        "last_earnings": None,  # most recent reported quarter: actual vs estimate
        "market_cap": None,
        "trailing_pe": None,
        "forward_pe": None,
        "fifty_two_week_high": None,
        "fifty_two_week_low": None,
    }

    # --- Finnhub (preferred) ---
    try:
        metric = await finnhub.basic_financials(sym)
        out["market_cap"] = metric.get("marketCapitalization")
        out["trailing_pe"] = metric.get("peTTM") or metric.get("peNormalizedAnnual")
        out["forward_pe"] = metric.get("peNTM") or metric.get("peExclExtraTTM")
        out["fifty_two_week_high"] = metric.get("52WeekHigh")
        out["fifty_two_week_low"] = metric.get("52WeekLow")
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
    # Recommendation trends: get latest-period buy/hold/sell breakdown + use the
    # sum as the analyst count if price-target didn't include it.
    try:
        recs = await finnhub.recommendation_trends(sym)
        if recs:
            latest = recs[0]  # Finnhub orders newest-first
            sb = int(latest.get("strongBuy") or 0)
            b = int(latest.get("buy") or 0)
            h = int(latest.get("hold") or 0)
            s = int(latest.get("sell") or 0)
            ss = int(latest.get("strongSell") or 0)
            total = sb + b + h + s + ss
            out["analyst_recommendation"] = {
                "strong_buy": sb,
                "buy": b,
                "hold": h,
                "sell": s,
                "strong_sell": ss,
                "total": total,
                "period": latest.get("period"),
            }
            if not out["analyst_count"] and total:
                out["analyst_count"] = total
    except Exception:
        pass
    try:
        er = await finnhub.earnings_for_symbol(sym)
        if er and er.get("date"):
            out["next_earnings"] = er["date"]
    except Exception:
        pass
    try:
        history = await finnhub.recent_earnings(sym, limit=1)
        if history:
            latest = history[0]
            out["last_earnings"] = {
                "period": latest.get("period"),
                "quarter": latest.get("quarter"),
                "year": latest.get("year"),
                "eps_actual": latest.get("actual"),
                "eps_estimate": latest.get("estimate"),
                "surprise": latest.get("surprise"),
                "surprise_percent": latest.get("surprisePercent"),
            }
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
