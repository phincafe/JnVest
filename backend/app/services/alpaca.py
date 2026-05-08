"""Thin async wrapper over Alpaca REST. WebSocket streaming is in ws.py."""

from datetime import datetime, timedelta
from typing import Any

import httpx

from ..config import get_settings
from . import cache

DATA_TIMEOUT = httpx.Timeout(10.0)


def _data_headers() -> dict[str, str]:
    s = get_settings()
    return {
        "APCA-API-KEY-ID": s.alpaca_api_key,
        "APCA-API-SECRET-KEY": s.alpaca_api_secret,
    }


def _trading_headers() -> dict[str, str]:
    return _data_headers()


def _has_creds() -> bool:
    s = get_settings()
    return bool(s.alpaca_api_key) and bool(s.alpaca_api_secret)


async def latest_quotes(symbols: list[str]) -> dict[str, Any]:
    """Latest IEX quotes for a list of symbols. Cached 30s."""
    if not symbols:
        return {}
    if not _has_creds():
        raise RuntimeError("Alpaca credentials not configured")

    key = "quotes:" + ",".join(sorted(symbols))

    async def fetch() -> dict[str, Any]:
        s = get_settings()
        url = f"{s.alpaca_data_url}/v2/stocks/quotes/latest"
        async with httpx.AsyncClient(timeout=DATA_TIMEOUT) as client:
            r = await client.get(
                url, params={"symbols": ",".join(symbols), "feed": "iex"}, headers=_data_headers()
            )
            r.raise_for_status()
            return r.json().get("quotes", {})

    return await cache.aget_or_set(key, fetch, ttl_seconds=30)


async def latest_trades(symbols: list[str]) -> dict[str, Any]:
    """Latest IEX trades for a list of symbols. Used for last-price tiles. Cached 30s."""
    if not symbols:
        return {}
    if not _has_creds():
        raise RuntimeError("Alpaca credentials not configured")

    key = "trades:" + ",".join(sorted(symbols))

    async def fetch() -> dict[str, Any]:
        s = get_settings()
        url = f"{s.alpaca_data_url}/v2/stocks/trades/latest"
        async with httpx.AsyncClient(timeout=DATA_TIMEOUT) as client:
            r = await client.get(
                url, params={"symbols": ",".join(symbols), "feed": "iex"}, headers=_data_headers()
            )
            r.raise_for_status()
            return r.json().get("trades", {})

    return await cache.aget_or_set(key, fetch, ttl_seconds=30)


def _is_stock_symbol(sym: str) -> bool:
    """Filter out crypto / forex symbols that don't belong in the stocks bars endpoint."""
    s = sym.upper()
    if "-" in s or "/" in s:
        return False
    if s in {"BTC", "ETH", "DOGE", "SOL", "XRP", "ADA", "LTC", "BCH", "MATIC", "AVAX", "DOT"}:
        return False
    return True


async def daily_bars(symbols: list[str], days: int = 35) -> dict[str, list[dict[str, Any]]]:
    """Recent daily bars for prev-close & % change. Cached 5 minutes.

    Filters crypto symbols out (they need a different endpoint) and follows
    next_page_token so a large watchlist doesn't get partially truncated.
    """
    if not symbols:
        return {}
    if not _has_creds():
        raise RuntimeError("Alpaca credentials not configured")

    stock_syms = [s for s in symbols if _is_stock_symbol(s)]
    if not stock_syms:
        return {}

    key = f"bars-daily-{days}:" + ",".join(sorted(stock_syms))

    async def fetch() -> dict[str, list[dict[str, Any]]]:
        s = get_settings()
        url = f"{s.alpaca_data_url}/v2/stocks/bars"
        start = (datetime.utcnow() - timedelta(days=days * 2)).strftime("%Y-%m-%d")
        out: dict[str, list[dict[str, Any]]] = {}
        page_token: str | None = None
        async with httpx.AsyncClient(timeout=DATA_TIMEOUT) as client:
            while True:
                params: dict[str, Any] = {
                    "symbols": ",".join(stock_syms),
                    "timeframe": "1Day",
                    "start": start,
                    "limit": 10000,
                    "adjustment": "all",
                    "feed": "iex",
                }
                if page_token:
                    params["page_token"] = page_token
                r = await client.get(url, params=params, headers=_data_headers())
                r.raise_for_status()
                body = r.json()
                page_bars = body.get("bars", {})
                for sym, bars in page_bars.items():
                    out.setdefault(sym, []).extend(bars)
                page_token = body.get("next_page_token")
                if not page_token:
                    break
        return out

    return await cache.aget_or_set(key, fetch, ttl_seconds=300)


async def bars(
    symbol: str, timeframe: str = "1Day", start: str | None = None, limit: int = 365
) -> list[dict[str, Any]]:
    """Historical bars for one symbol. Used by stock detail chart."""
    if not _has_creds():
        raise RuntimeError("Alpaca credentials not configured")
    s = get_settings()
    url = f"{s.alpaca_data_url}/v2/stocks/{symbol}/bars"
    params: dict[str, Any] = {"timeframe": timeframe, "limit": limit, "feed": "iex"}
    if start:
        params["start"] = start

    key = f"bars:{symbol}:{timeframe}:{start}:{limit}"

    async def fetch() -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=DATA_TIMEOUT) as client:
            r = await client.get(url, params=params, headers=_data_headers())
            r.raise_for_status()
            return r.json().get("bars", [])

    return await cache.aget_or_set(key, fetch, ttl_seconds=60)


async def get_account() -> dict[str, Any]:
    if not _has_creds():
        raise RuntimeError("Alpaca credentials not configured")
    s = get_settings()
    async with httpx.AsyncClient(timeout=DATA_TIMEOUT) as client:
        r = await client.get(f"{s.alpaca_base_url}/v2/account", headers=_trading_headers())
        r.raise_for_status()
        return r.json()


async def get_positions() -> list[dict[str, Any]]:
    if not _has_creds():
        raise RuntimeError("Alpaca credentials not configured")
    s = get_settings()
    async with httpx.AsyncClient(timeout=DATA_TIMEOUT) as client:
        r = await client.get(f"{s.alpaca_base_url}/v2/positions", headers=_trading_headers())
        r.raise_for_status()
        return r.json()


async def get_orders(limit: int = 20) -> list[dict[str, Any]]:
    if not _has_creds():
        raise RuntimeError("Alpaca credentials not configured")
    s = get_settings()
    async with httpx.AsyncClient(timeout=DATA_TIMEOUT) as client:
        r = await client.get(
            f"{s.alpaca_base_url}/v2/orders",
            params={"status": "all", "limit": limit, "direction": "desc"},
            headers=_trading_headers(),
        )
        r.raise_for_status()
        return r.json()


async def submit_order(payload: dict[str, Any]) -> dict[str, Any]:
    s = get_settings()
    if not s.is_paper:
        raise PermissionError("Order submission disabled outside paper trading.")
    if not _has_creds():
        raise RuntimeError("Alpaca credentials not configured")
    async with httpx.AsyncClient(timeout=DATA_TIMEOUT) as client:
        r = await client.post(
            f"{s.alpaca_base_url}/v2/orders", json=payload, headers=_trading_headers()
        )
        r.raise_for_status()
        return r.json()
