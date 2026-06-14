"""2026 FIFA World Cup data via ESPN's public (undocumented) soccer API.

No API key required. Two endpoints we consume:
  - /scoreboard  → live + scheduled + finished matches for the current day
  - /standings   → group tables

ESPN updates the scoreboard roughly every 20-30s during live play, so we
cache the scoreboard briefly (live polling stays cheap but fresh) and the
standings longer (they only change at full-time). Parsing is defensive —
ESPN's shapes drift, and a missing field must degrade to None, never 500.
"""

from typing import Any

import httpx

from . import cache

BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world"
# Standings live under the v2 core path, not the site path.
STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings"
TIMEOUT = httpx.Timeout(8.0)


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _competitor(c: dict[str, Any]) -> dict[str, Any]:
    team = c.get("team") or {}
    return {
        "id": team.get("id"),
        "name": team.get("displayName") or team.get("name"),
        "abbr": team.get("abbreviation"),
        "logo": team.get("logo"),
        "score": _num(c.get("score")),
        "winner": bool(c.get("winner")),
        "home_away": c.get("homeAway"),
    }


def _parse_event(ev: dict[str, Any]) -> dict[str, Any]:
    comp = (ev.get("competitions") or [{}])[0]
    status = ev.get("status") or comp.get("status") or {}
    stype = status.get("type") or {}
    competitors = comp.get("competitors") or []
    home = next((c for c in competitors if c.get("homeAway") == "home"), None)
    away = next((c for c in competitors if c.get("homeAway") == "away"), None)
    # Fall back to positional order if homeAway is missing.
    if home is None and competitors:
        home = competitors[0]
    if away is None and len(competitors) > 1:
        away = competitors[1]
    venue = comp.get("venue") or {}
    # Group / round label, when ESPN tags it (e.g. "Group F").
    notes = comp.get("notes") or []
    group = notes[0].get("headline") if notes and isinstance(notes[0], dict) else None
    return {
        "id": ev.get("id"),
        "date": ev.get("date"),
        # state: "pre" (scheduled) | "in" (live) | "post" (finished)
        "state": stype.get("state"),
        "status_detail": stype.get("shortDetail") or stype.get("detail"),
        "clock": status.get("displayClock"),
        "completed": bool(stype.get("completed")),
        "venue": venue.get("fullName"),
        "group": group,
        "home": _competitor(home) if home else None,
        "away": _competitor(away) if away else None,
    }


async def scoreboard() -> dict[str, Any]:
    """Today's matches (live + scheduled + finished). Cached 20s so live
    polling is fresh without hammering ESPN."""

    async def fetch() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(f"{BASE}/scoreboard")
            r.raise_for_status()
            body = r.json() or {}
        events = [_parse_event(e) for e in (body.get("events") or [])]
        # Live first, then scheduled (by kickoff), then finished.
        order = {"in": 0, "pre": 1, "post": 2}
        events.sort(key=lambda e: (order.get(e.get("state"), 3), e.get("date") or ""))
        league = (body.get("leagues") or [{}])[0]
        return {
            "season": league.get("season", {}).get("displayName") or league.get("name"),
            "events": events,
            "live_count": sum(1 for e in events if e.get("state") == "in"),
        }

    return await cache.aget_or_set("worldcup:scoreboard", fetch, ttl_seconds=20)


def _stat(entry: dict[str, Any], *names: str) -> float | None:
    """Pull the first matching stat by name from an ESPN standings entry."""
    by_name = {s.get("name"): s for s in (entry.get("stats") or [])}
    for n in names:
        s = by_name.get(n)
        if s is not None:
            return _num(s.get("value"))
    return None


def _parse_group(child: dict[str, Any]) -> dict[str, Any]:
    standings = child.get("standings") or {}
    entries = standings.get("entries") or []
    rows = []
    for e in entries:
        team = e.get("team") or {}
        rows.append(
            {
                "id": team.get("id"),
                "name": team.get("displayName") or team.get("name"),
                "abbr": team.get("abbreviation"),
                "logo": team.get("logo"),
                "rank": _stat(e, "rank"),
                "played": _stat(e, "gamesPlayed"),
                "wins": _stat(e, "wins"),
                "draws": _stat(e, "ties", "draws"),
                "losses": _stat(e, "losses"),
                "gf": _stat(e, "pointsFor", "goalsFor"),
                "ga": _stat(e, "pointsAgainst", "goalsAgainst"),
                "gd": _stat(e, "pointDifferential", "goalDifferential"),
                "points": _stat(e, "points"),
            }
        )
    rows.sort(key=lambda r: (r.get("rank") if r.get("rank") is not None else 99))
    return {"name": child.get("name") or child.get("abbreviation"), "teams": rows}


async def standings() -> dict[str, Any]:
    """Group tables. Cached 5 min — they only move at full-time."""

    async def fetch() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(STANDINGS_URL)
            r.raise_for_status()
            body = r.json() or {}
        children = body.get("children") or []
        groups = [_parse_group(c) for c in children if c.get("standings")]
        return {"groups": groups}

    return await cache.aget_or_set("worldcup:standings", fetch, ttl_seconds=300)
