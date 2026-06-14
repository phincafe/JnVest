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


# Match-stat fields we surface, in display order. (espn_name, label, suffix).
# wonCorners is the per-team corner count the user asked for.
_STAT_SPECS: list[tuple[str, str, str]] = [
    ("possessionPct", "Possession", "%"),
    ("totalShots", "Shots", ""),
    ("shotsOnTarget", "Shots on target", ""),
    ("wonCorners", "Corners", ""),
    ("foulsCommitted", "Fouls", ""),
    ("yellowCards", "Yellow cards", ""),
    ("redCards", "Red cards", ""),
    ("offsides", "Offsides", ""),
    ("saves", "Saves", ""),
    ("totalPasses", "Passes", ""),
    ("passPct", "Pass accuracy", "%"),
]


def _team_stat_map(team_box: dict[str, Any]) -> dict[str, str]:
    """name -> displayValue for one team's boxscore statistics."""
    return {
        s.get("name"): s.get("displayValue")
        for s in (team_box.get("statistics") or [])
        if s.get("name")
    }


def _header_side(competitors: list[dict[str, Any]], home_away: str) -> dict[str, Any] | None:
    c = next((x for x in competitors if x.get("homeAway") == home_away), None)
    if c is None:
        return None
    team = c.get("team") or {}
    return {
        "id": team.get("id"),
        "name": team.get("displayName") or team.get("name"),
        "abbr": team.get("abbreviation"),
        "logo": (
            (team.get("logos") or [{}])[0].get("href") if team.get("logos") else team.get("logo")
        ),
        "score": _num(c.get("score")),
        "winner": bool(c.get("winner")),
    }


def _odds(summary: dict[str, Any]) -> dict[str, Any] | None:
    pc = (summary.get("pickcenter") or [None])[0]
    if not pc:
        return None
    ml = pc.get("moneyline") or {}

    def side(name: str) -> str | None:
        o = ml.get(name) or {}
        node = o.get("close") or o.get("open") or {}
        return node.get("odds")

    moneyline = {"home": side("home"), "draw": side("draw"), "away": side("away")}
    if not any(moneyline.values()):
        moneyline = None  # type: ignore[assignment]
    return {
        "provider": (pc.get("provider") or {}).get("name"),
        "details": pc.get("details"),
        "over_under": pc.get("overUnder"),
        "spread": pc.get("spread"),
        "moneyline": moneyline,
    }


def _key_events(summary: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for e in summary.get("keyEvents") or []:
        ttype = (e.get("type") or {}).get("text") or ""
        low = ttype.lower()
        if not ("goal" in low or "card" in low or "penalty" in low):
            continue
        team = e.get("team") or {}
        out.append(
            {
                "clock": (e.get("clock") or {}).get("displayValue"),
                "type": ttype,
                "text": e.get("text"),
                "team_abbr": team.get("abbreviation"),
            }
        )
    out.reverse()  # latest first
    return out


async def match(event_id: str) -> dict[str, Any]:
    """Full match detail: live team stats (corners, possession, shots, …),
    betting odds, and goal/card events. Cached 15s for live polling."""

    async def fetch() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(f"{BASE}/summary", params={"event": event_id})
            r.raise_for_status()
            s = r.json() or {}

        header = s.get("header") or {}
        comp = (header.get("competitions") or [{}])[0]
        competitors = comp.get("competitors") or []
        status = (comp.get("status") or {}).get("type") or {}
        home = _header_side(competitors, "home")
        away = _header_side(competitors, "away")

        # Boxscore teams are ordered [away, home] or [home, away]; match by id.
        teams = (s.get("boxscore") or {}).get("teams") or []
        stat_by_id: dict[str, dict[str, str]] = {}
        for t in teams:
            tid = (t.get("team") or {}).get("id")
            if tid:
                stat_by_id[tid] = _team_stat_map(t)
        home_stats = stat_by_id.get((home or {}).get("id"), {})
        away_stats = stat_by_id.get((away or {}).get("id"), {})

        stats = []
        for name, label, suffix in _STAT_SPECS:
            hv, av = home_stats.get(name), away_stats.get(name)
            if hv is None and av is None:
                continue
            stats.append(
                {
                    "label": label,
                    "suffix": suffix,
                    "home": hv,
                    "away": av,
                    "home_num": _num((hv or "").replace("%", "")),
                    "away_num": _num((av or "").replace("%", "")),
                }
            )

        return {
            "id": event_id,
            "state": status.get("state"),
            "status_detail": status.get("shortDetail") or status.get("detail"),
            "venue": (comp.get("venue") or {}).get("fullName"),
            "home": home,
            "away": away,
            "stats": stats,
            "odds": _odds(s),
            "events": _key_events(s),
        }

    return await cache.aget_or_set(f"worldcup:match:{event_id}", fetch, ttl_seconds=15)
