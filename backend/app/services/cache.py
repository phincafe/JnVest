"""In-memory TTL cache. Single-process — fine for one Render worker."""

import time
from collections.abc import Awaitable, Callable
from typing import Any

_store: dict[str, tuple[float, Any]] = {}


def get(key: str) -> Any | None:
    item = _store.get(key)
    if item is None:
        return None
    expires_at, value = item
    if time.time() > expires_at:
        _store.pop(key, None)
        return None
    return value


def put(key: str, value: Any, ttl_seconds: int = 60) -> None:
    _store[key] = (time.time() + ttl_seconds, value)


async def aget_or_set(key: str, fetch: Callable[[], Awaitable[Any]], ttl_seconds: int = 60) -> Any:
    cached = get(key)
    if cached is not None:
        return cached
    value = await fetch()
    put(key, value, ttl_seconds)
    return value


def clear() -> None:
    _store.clear()
