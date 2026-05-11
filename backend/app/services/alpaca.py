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
    """Latest trades for a mixed list of stocks + crypto. Each kind hits its
    own Alpaca endpoint; results merged by original ticker. Cached 30s."""
    if not symbols:
        return {}
    if not _has_creds():
        raise RuntimeError("Alpaca credentials not configured")

    stock_syms = [s for s in symbols if _is_stock_symbol(s)]
    crypto_syms = [s for s in symbols if is_crypto_symbol(s)]

    out: dict[str, Any] = {}
    if stock_syms:
        key = "trades:" + ",".join(sorted(stock_syms))

        async def fetch_stocks() -> dict[str, Any]:
            s = get_settings()
            url = f"{s.alpaca_data_url}/v2/stocks/trades/latest"
            async with httpx.AsyncClient(timeout=DATA_TIMEOUT) as client:
                r = await client.get(
                    url,
                    params={"symbols": ",".join(stock_syms), "feed": "iex"},
                    headers=_data_headers(),
                )
                r.raise_for_status()
                return r.json().get("trades", {})

        stock_trades = await cache.aget_or_set(key, fetch_stocks, ttl_seconds=30)
        out.update(stock_trades)
    if crypto_syms:
        out.update(await crypto_latest_trades(crypto_syms))
    return out


CRYPTO_TICKERS = {
    "BTC",
    "ETH",
    "DOGE",
    "SOL",
    "XRP",
    "ADA",
    "LTC",
    "BCH",
    "MATIC",
    "AVAX",
    "DOT",
    "LINK",
    "USDT",
    "USDC",
    "SHIB",
    "UNI",
    "AAVE",
    "ATOM",
    "ALGO",
    "FIL",
    "ICP",
    "NEAR",
    "TRX",
    "XLM",
    "BNB",
    "TON",
    "ARB",
    "OP",
    "MKR",
    "SUI",
}


def is_crypto_symbol(sym: str) -> bool:
    s = sym.upper()
    if "/" in s:
        return True
    return s in CRYPTO_TICKERS


def _is_stock_symbol(sym: str) -> bool:
    return not is_crypto_symbol(sym) and "-" not in sym


def _to_crypto_pair(sym: str) -> str:
    """'BTC' -> 'BTC/USD'. Already-paired returned as-is."""
    s = sym.upper()
    return s if "/" in s else f"{s}/USD"


def _from_crypto_pair(pair: str) -> str:
    """'BTC/USD' -> 'BTC'."""
    return pair.split("/")[0].upper()


async def crypto_latest_trades(symbols: list[str]) -> dict[str, Any]:
    """Latest crypto trades. Returns {original_ticker: trade_data}."""
    if not symbols:
        return {}
    if not _has_creds():
        raise RuntimeError("Alpaca credentials not configured")

    pairs = [_to_crypto_pair(s) for s in symbols]
    key = "crypto-trades:" + ",".join(sorted(pairs))

    async def fetch() -> dict[str, Any]:
        url = "https://data.alpaca.markets/v1beta3/crypto/us/latest/trades"
        async with httpx.AsyncClient(timeout=DATA_TIMEOUT) as client:
            r = await client.get(url, params={"symbols": ",".join(pairs)}, headers=_data_headers())
            r.raise_for_status()
            raw = r.json().get("trades", {})
            # Map "BTC/USD" -> "BTC" so callers can look up by their watchlist symbol.
            return {_from_crypto_pair(k): v for k, v in raw.items()}

    return await cache.aget_or_set(key, fetch, ttl_seconds=30)


async def crypto_daily_bars(symbols: list[str], days: int = 35) -> dict[str, list[dict[str, Any]]]:
    """Daily crypto bars. Returns {original_ticker: [bars]}."""
    if not symbols:
        return {}
    if not _has_creds():
        raise RuntimeError("Alpaca credentials not configured")

    pairs = [_to_crypto_pair(s) for s in symbols]
    key = f"crypto-bars-daily-{days}:" + ",".join(sorted(pairs))

    async def fetch() -> dict[str, list[dict[str, Any]]]:
        url = "https://data.alpaca.markets/v1beta3/crypto/us/bars"
        start = (datetime.utcnow() - timedelta(days=days * 2)).strftime("%Y-%m-%d")
        out: dict[str, list[dict[str, Any]]] = {}
        page_token: str | None = None
        async with httpx.AsyncClient(timeout=DATA_TIMEOUT) as client:
            while True:
                params: dict[str, Any] = {
                    "symbols": ",".join(pairs),
                    "timeframe": "1Day",
                    "start": start,
                    "limit": 10000,
                }
                if page_token:
                    params["page_token"] = page_token
                r = await client.get(url, params=params, headers=_data_headers())
                r.raise_for_status()
                body = r.json()
                page_bars = body.get("bars", {})
                for pair, bars in page_bars.items():
                    sym = _from_crypto_pair(pair)
                    out.setdefault(sym, []).extend(bars)
                page_token = body.get("next_page_token")
                if not page_token:
                    break
        return out

    return await cache.aget_or_set(key, fetch, ttl_seconds=300)


async def daily_bars(symbols: list[str], days: int = 35) -> dict[str, list[dict[str, Any]]]:
    """Recent daily bars for prev-close & % change. Splits stock vs crypto and
    calls the appropriate Alpaca endpoint for each. Cached 5 minutes."""
    if not symbols:
        return {}
    if not _has_creds():
        raise RuntimeError("Alpaca credentials not configured")

    stock_syms = [s for s in symbols if _is_stock_symbol(s)]
    crypto_syms = [s for s in symbols if is_crypto_symbol(s)]

    out: dict[str, list[dict[str, Any]]] = {}
    if crypto_syms:
        out.update(await crypto_daily_bars(crypto_syms, days=days))
    if not stock_syms:
        return out

    key = f"bars-daily-{days}:" + ",".join(sorted(stock_syms))

    async def fetch() -> dict[str, list[dict[str, Any]]]:
        s = get_settings()
        url = f"{s.alpaca_data_url}/v2/stocks/bars"
        start = (datetime.utcnow() - timedelta(days=days * 2)).strftime("%Y-%m-%d")
        stock_out: dict[str, list[dict[str, Any]]] = {}
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
                    stock_out.setdefault(sym, []).extend(bars)
                page_token = body.get("next_page_token")
                if not page_token:
                    break
        return stock_out

    out.update(await cache.aget_or_set(key, fetch, ttl_seconds=300))
    return out


async def bars(
    symbol: str, timeframe: str = "1Day", start: str | None = None, limit: int = 365
) -> list[dict[str, Any]]:
    """Historical bars for one symbol. Used by stock detail chart.

    `adjustment=all` is critical: without it, Alpaca returns raw historical
    prices, so any post-split company (e.g. NOW after its 10:1) shows a
    fake cliff where pre-split history meets the post-split current quote."""
    if not _has_creds():
        raise RuntimeError("Alpaca credentials not configured")
    s = get_settings()
    url = f"{s.alpaca_data_url}/v2/stocks/{symbol}/bars"
    params: dict[str, Any] = {
        "timeframe": timeframe,
        "limit": limit,
        "feed": "iex",
        "adjustment": "all",
    }
    if start:
        params["start"] = start

    # v2 in the cache key invalidates the old (unadjusted) cached payloads.
    key = f"bars:v2:{symbol}:{timeframe}:{start}:{limit}"

    async def fetch() -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=DATA_TIMEOUT) as client:
            r = await client.get(url, params=params, headers=_data_headers())
            r.raise_for_status()
            return r.json().get("bars", [])

    return await cache.aget_or_set(key, fetch, ttl_seconds=60)


async def option_snapshots(occ_symbols: list[str]) -> dict[str, dict[str, Any]]:
    """Latest snapshots (quote + last trade) for OCC option symbols. Cached 30s.

    OCC format: SYMBOLYYMMDDC|PSTRIKExxxxxxxx (strike × 1000, 8-digit padded).
    Returns {} on error or no creds — caller falls back to SnapTrade pricing.
    """
    if not occ_symbols:
        return {}
    if not _has_creds():
        return {}
    key = "opt-snap:" + ",".join(sorted(occ_symbols))

    async def fetch() -> dict[str, dict[str, Any]]:
        url = "https://data.alpaca.markets/v1beta1/options/snapshots"
        try:
            async with httpx.AsyncClient(timeout=DATA_TIMEOUT) as client:
                # Alpaca caps batch size around 100 symbols; chunk to be safe.
                out: dict[str, dict[str, Any]] = {}
                for i in range(0, len(occ_symbols), 100):
                    batch = occ_symbols[i : i + 100]
                    r = await client.get(
                        url, params={"symbols": ",".join(batch)}, headers=_data_headers()
                    )
                    if r.status_code in (404, 422):
                        continue
                    r.raise_for_status()
                    out.update(r.json().get("snapshots", {}))
                return out
        except Exception:
            return {}

    return await cache.aget_or_set(key, fetch, ttl_seconds=30)


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
