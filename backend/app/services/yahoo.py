"""yfinance-backed helpers for things Alpaca doesn't give us cheaply:
options chains, IV history, earnings dates, analyst targets.

yfinance is sync-only and slow — wrap calls in `asyncio.to_thread` and cache aggressively.
"""

import asyncio
from datetime import datetime
from typing import Any

import yfinance as yf

from . import cache


async def info(symbol: str) -> dict[str, Any]:
    """Cached for 30 minutes — earnings dates, analyst targets, etc."""

    async def fetch() -> dict[str, Any]:
        def _sync() -> dict[str, Any]:
            t = yf.Ticker(symbol)
            try:
                return dict(t.info or {})
            except Exception:
                return {}

        return await asyncio.to_thread(_sync)

    return await cache.aget_or_set(f"yahoo-info:{symbol}", fetch, ttl_seconds=1800)


async def next_earnings_date(symbol: str) -> str | None:
    data = await info(symbol)
    ts = data.get("earningsTimestamp") or data.get("earningsTimestampStart")
    if not ts:
        return None
    try:
        return datetime.utcfromtimestamp(int(ts)).strftime("%Y-%m-%d")
    except (ValueError, TypeError, OSError):
        return None


async def expirations(symbol: str) -> list[str]:
    """Available options expiration strings (YYYY-MM-DD). Cached 30 min."""

    async def fetch() -> list[str]:
        def _sync() -> list[str]:
            t = yf.Ticker(symbol)
            try:
                return list(t.options or [])
            except Exception:
                return []

        return await asyncio.to_thread(_sync)

    return await cache.aget_or_set(f"yahoo-exps:{symbol}", fetch, ttl_seconds=1800)


async def option_chain(symbol: str, expiration: str) -> dict[str, list[dict[str, Any]]]:
    """Returns {'calls': [...], 'puts': [...]} for a single expiration. Cached 60s."""

    async def fetch() -> dict[str, list[dict[str, Any]]]:
        def _sync() -> dict[str, list[dict[str, Any]]]:
            t = yf.Ticker(symbol)
            try:
                chain = t.option_chain(expiration)
            except Exception:
                return {"calls": [], "puts": []}

            def to_records(df) -> list[dict[str, Any]]:
                if df is None or len(df) == 0:
                    return []
                # yfinance returns numpy types — coerce to native for json serialization.
                records = df.to_dict(orient="records")
                cleaned: list[dict[str, Any]] = []
                for r in records:
                    cleaned.append({k: _coerce(v) for k, v in r.items()})
                return cleaned

            return {"calls": to_records(chain.calls), "puts": to_records(chain.puts)}

        return await asyncio.to_thread(_sync)

    return await cache.aget_or_set(f"yahoo-chain:{symbol}:{expiration}", fetch, ttl_seconds=60)


def _coerce(v: Any) -> Any:
    # numpy / pandas → python primitives
    if hasattr(v, "item"):
        try:
            return v.item()
        except (ValueError, TypeError):
            pass
    return v
