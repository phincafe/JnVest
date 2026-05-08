"""Finnhub free tier: company news + market news + earnings calendar + econ calendar."""

from datetime import datetime, timedelta
from typing import Any

import httpx

from ..config import get_settings
from . import cache

BASE = "https://finnhub.io/api/v1"
TIMEOUT = httpx.Timeout(10.0)


def _key() -> str:
    k = get_settings().finnhub_api_key
    if not k:
        raise RuntimeError("FINNHUB_API_KEY not configured")
    return k


async def company_news(symbol: str, days_back: int = 30) -> list[dict[str, Any]]:
    """Recent company news. Finnhub returns full articles; we trim downstream.
    Default 30 days because thinly-covered small/mid-caps may go a week between
    headlines."""

    async def fetch() -> list[dict[str, Any]]:
        to = datetime.utcnow().date()
        frm = to - timedelta(days=days_back)
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{BASE}/company-news",
                params={
                    "symbol": symbol,
                    "from": frm.isoformat(),
                    "to": to.isoformat(),
                    "token": _key(),
                },
            )
            r.raise_for_status()
            return r.json() or []

    return await cache.aget_or_set(f"finnhub-news:{symbol}:{days_back}", fetch, ttl_seconds=300)


async def earnings_calendar(days_ahead: int = 7) -> list[dict[str, Any]]:
    async def fetch() -> list[dict[str, Any]]:
        frm = datetime.utcnow().date()
        to = frm + timedelta(days=days_ahead)
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{BASE}/calendar/earnings",
                params={"from": frm.isoformat(), "to": to.isoformat(), "token": _key()},
            )
            r.raise_for_status()
            return (r.json() or {}).get("earningsCalendar") or []

    return await cache.aget_or_set(f"finnhub-earnings:{days_ahead}", fetch, ttl_seconds=900)


async def company_profile(symbol: str) -> dict[str, Any]:
    """Reliable company info: name, market cap, ticker, exchange, industry."""

    async def fetch() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{BASE}/stock/profile2",
                params={"symbol": symbol, "token": _key()},
            )
            r.raise_for_status()
            return r.json() or {}

    return await cache.aget_or_set(f"finnhub-profile:{symbol}", fetch, ttl_seconds=86400)


async def basic_financials(symbol: str) -> dict[str, Any]:
    """Free-tier `metric` payload: P/E, market cap, 52w hi/lo, beta, etc."""

    async def fetch() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{BASE}/stock/metric",
                params={"symbol": symbol, "metric": "all", "token": _key()},
            )
            r.raise_for_status()
            return (r.json() or {}).get("metric") or {}

    return await cache.aget_or_set(f"finnhub-metric:{symbol}", fetch, ttl_seconds=3600)


async def recommendation_trends(symbol: str) -> list[dict[str, Any]]:
    async def fetch() -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{BASE}/stock/recommendation",
                params={"symbol": symbol, "token": _key()},
            )
            r.raise_for_status()
            return r.json() or []

    return await cache.aget_or_set(f"finnhub-rec:{symbol}", fetch, ttl_seconds=3600)


async def price_target(symbol: str) -> dict[str, Any]:
    async def fetch() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{BASE}/stock/price-target",
                params={"symbol": symbol, "token": _key()},
            )
            r.raise_for_status()
            return r.json() or {}

    return await cache.aget_or_set(f"finnhub-pt:{symbol}", fetch, ttl_seconds=3600)


async def earnings_for_symbol(symbol: str) -> dict[str, Any] | None:
    """Next earnings date for a single symbol (best-effort, may be empty)."""
    today = datetime.utcnow().date()
    end = today + timedelta(days=180)

    async def fetch() -> dict[str, Any] | None:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{BASE}/calendar/earnings",
                params={
                    "from": today.isoformat(),
                    "to": end.isoformat(),
                    "symbol": symbol,
                    "token": _key(),
                },
            )
            r.raise_for_status()
            entries = (r.json() or {}).get("earningsCalendar") or []
            return entries[0] if entries else None

    return await cache.aget_or_set(f"finnhub-er:{symbol}", fetch, ttl_seconds=3600)


async def market_news(category: str = "general", limit: int = 30) -> list[dict[str, Any]]:
    """General market news (or 'forex'/'crypto'/'merger'). Free tier."""

    async def fetch() -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{BASE}/news",
                params={"category": category, "token": _key()},
            )
            r.raise_for_status()
            return (r.json() or [])[:limit]

    return await cache.aget_or_set(f"finnhub-news-{category}", fetch, ttl_seconds=300)


async def insider_transactions(symbol: str, limit: int = 25) -> list[dict[str, Any]]:
    """Recent Form 4 insider trades for a symbol. Free tier."""

    async def fetch() -> list[dict[str, Any]]:
        # Look back 90 days; that's typically enough activity to see a pattern.
        to = datetime.utcnow().date()
        frm = to - timedelta(days=90)
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{BASE}/stock/insider-transactions",
                params={
                    "symbol": symbol,
                    "from": frm.isoformat(),
                    "to": to.isoformat(),
                    "token": _key(),
                },
            )
            r.raise_for_status()
            data = (r.json() or {}).get("data") or []
            return data[:limit]

    return await cache.aget_or_set(f"finnhub-insider:{symbol}", fetch, ttl_seconds=3600)


async def economic_calendar(days_ahead: int = 1) -> list[dict[str, Any]]:
    """Economic releases (CPI, jobs, FOMC, etc.). US-only filter applied downstream."""

    async def fetch() -> list[dict[str, Any]]:
        frm = datetime.utcnow().date()
        to = frm + timedelta(days=days_ahead)
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{BASE}/calendar/economic",
                params={"from": frm.isoformat(), "to": to.isoformat(), "token": _key()},
            )
            r.raise_for_status()
            return (r.json() or {}).get("economicCalendar") or []

    return await cache.aget_or_set(f"finnhub-econ:{days_ahead}", fetch, ttl_seconds=900)
