"""ApeWisdom: free WSB / retail social-sentiment ranking. No auth required.

Endpoint: https://apewisdom.io/api/v1.0/filter/{filter}
We default to wallstreetbets but the same shape works for stocktwits, etc.
"""

from typing import Any

import httpx

from . import cache

BASE = "https://apewisdom.io/api/v1.0"
TIMEOUT = httpx.Timeout(10.0)


def _coerce_int(item: dict[str, Any], key: str) -> int | None:
    v = item.get(key)
    try:
        return int(v) if v is not None else None
    except (ValueError, TypeError):
        return None


def _coerce_float(item: dict[str, Any], key: str) -> float | None:
    v = item.get(key)
    try:
        return float(v) if v is not None else None
    except (ValueError, TypeError):
        return None


async def trending(filter_name: str = "wallstreetbets", limit: int = 10) -> list[dict[str, Any]]:
    """Top tickers by mention count on the given subreddit/board, plus 24h
    delta and basic sentiment counts. Cached 15 min.

    Returned shape per item: {symbol, name, mentions, mentions_24h_ago, rank,
    rank_24h_ago, upvotes, sentiment} — where sentiment is 0..100 (50 = neutral)."""

    async def fetch() -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(f"{BASE}/filter/{filter_name}")
            r.raise_for_status()
            body = r.json() or {}
            results = body.get("results") or []
            out: list[dict[str, Any]] = []
            for item in results[:limit]:
                out.append(
                    {
                        "symbol": (item.get("ticker") or "").upper(),
                        "name": item.get("name"),
                        "mentions": _coerce_int(item, "mentions"),
                        "mentions_24h_ago": _coerce_int(item, "mentions_24h_ago"),
                        "rank": _coerce_int(item, "rank"),
                        "rank_24h_ago": _coerce_int(item, "rank_24h_ago"),
                        "upvotes": _coerce_int(item, "upvotes"),
                        "sentiment": _coerce_float(item, "sentiment"),
                        "sentiment_score": _coerce_float(item, "sentiment_score"),
                    }
                )
            return out

    return await cache.aget_or_set(f"apewisdom:{filter_name}:{limit}", fetch, ttl_seconds=900)
