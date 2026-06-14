"""The Odds API (the-odds-api.com) — real-time sportsbook odds for the World
Cup tab. Free tier is 500 requests/month, so EVERYTHING here is cached hard
and the whole module degrades to empty results when the key is unset or the
monthly quota is spent — callers then fall back to ESPN's (laggy) feed.

Security: the API key travels in the URL query string, so an httpx exception
would leak it. We never return raw exceptions to callers; failures log a
sanitized message and return empty so the World Cup tab keeps working.
"""

import logging
from typing import Any

import httpx

from ..config import get_settings
from . import cache

BASE = "https://api.the-odds-api.com/v4"
TIMEOUT = httpx.Timeout(8.0)
log = logging.getLogger("jnvest.oddsapi")

# One h2h request returns ALL World Cup games, so a single cached blob covers
# every match modal. 180s keeps it live-ish while protecting the 500/mo quota
# (≈1 call per 3 min even with a modal open and polling).
_H2H_TTL = 180
# Outright winner odds move slowly — cache an hour.
_OUTRIGHT_TTL = 3600
# Bookmakers to prefer, in order, when a game lists several.
_BOOK_PREFERENCE = ("draftkings", "fanduel", "betmgm")


def _key() -> str | None:
    return get_settings().odds_api_key or None


def _american(price: Any) -> str | None:
    try:
        n = int(round(float(price)))
    except (TypeError, ValueError):
        return None
    return f"+{n}" if n > 0 else str(n)


def _pick_book(game: dict[str, Any]) -> dict[str, Any] | None:
    books = game.get("bookmakers") or []
    if not books:
        return None
    for pref in _BOOK_PREFERENCE:
        b = next((x for x in books if x.get("key") == pref), None)
        if b:
            return b
    return books[0]


async def h2h_games() -> list[dict[str, Any]]:
    """All World Cup match h2h (moneyline) odds. Empty list when unavailable."""
    if not _key():
        return []

    async def fetch() -> list[dict[str, Any]]:
        params = {
            "apiKey": _key(),
            "regions": "us",
            "markets": "h2h",
            "oddsFormat": "american",
        }
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(f"{BASE}/sports/soccer_fifa_world_cup/odds", params=params)
            if r.status_code != 200:
                # 401/402/429 → bad key or quota spent. Degrade quietly.
                log.warning("odds-api h2h non-200: %s", r.status_code)
                return []
            rem = r.headers.get("x-requests-remaining")
            if rem is not None:
                log.info("odds-api requests remaining: %s", rem)
            return r.json() or []

    try:
        return await cache.aget_or_set("oddsapi:h2h", fetch, ttl_seconds=_H2H_TTL)
    except Exception as e:
        log.warning("odds-api h2h failed: %r", e)
        return []


def match_moneyline(
    games: list[dict[str, Any]], home_name: str | None, away_name: str | None
) -> dict[str, Any] | None:
    """Find a game by team names and return our standard odds dict, or None."""
    if not (home_name and away_name):
        return None
    hn, an = home_name.lower(), away_name.lower()
    game = next(
        (
            g
            for g in games
            if {(g.get("home_team") or "").lower(), (g.get("away_team") or "").lower()} == {hn, an}
        ),
        None,
    )
    if game is None:
        return None
    book = _pick_book(game)
    if not book:
        return None
    market = next((m for m in book.get("markets") or [] if m.get("key") == "h2h"), None)
    if not market:
        return None
    prices: dict[str, str | None] = {"home": None, "away": None, "draw": None}
    for oc in market.get("outcomes") or []:
        name = (oc.get("name") or "").lower()
        if name == "draw":
            prices["draw"] = _american(oc.get("price"))
        elif name == (game.get("home_team") or "").lower():
            prices["home"] = _american(oc.get("price"))
        elif name == (game.get("away_team") or "").lower():
            prices["away"] = _american(oc.get("price"))
    if not any(prices.values()):
        return None
    return {
        "provider": (book.get("title") or book.get("key")),
        "details": None,
        "over_under": None,
        "spread": None,
        "moneyline": prices,
        "is_live": True,
        # True real-time book line (not ESPN's lagged feed).
        "delayed": False,
    }


async def outright_winner(limit: int = 16) -> dict[str, Any]:
    """Tournament-winner outright odds (top `limit` shortest prices)."""
    if not _key():
        return {"teams": [], "provider": None}

    async def fetch() -> dict[str, Any]:
        params = {
            "apiKey": _key(),
            "regions": "us",
            "markets": "outrights",
            "oddsFormat": "american",
        }
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(f"{BASE}/sports/soccer_fifa_world_cup_winner/odds", params=params)
            if r.status_code != 200:
                log.warning("odds-api outright non-200: %s", r.status_code)
                return {"teams": [], "provider": None}
            data = r.json() or []
        if not data:
            return {"teams": [], "provider": None}
        book = _pick_book(data[0])
        if not book:
            return {"teams": [], "provider": None}
        market = next((m for m in book.get("markets") or [] if m.get("key") == "outrights"), None)
        outcomes = (market or {}).get("outcomes") or []
        teams = sorted(outcomes, key=lambda o: o.get("price", 1e9))[:limit]
        return {
            "provider": book.get("title") or book.get("key"),
            "teams": [{"team": o.get("name"), "odds": _american(o.get("price"))} for o in teams],
        }

    try:
        return await cache.aget_or_set("oddsapi:outright", fetch, ttl_seconds=_OUTRIGHT_TTL)
    except Exception as e:
        log.warning("odds-api outright failed: %r", e)
        return {"teams": [], "provider": None}
