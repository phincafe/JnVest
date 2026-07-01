"""2026 FIFA World Cup data via ESPN's public (undocumented) soccer API.

No API key required. Two endpoints we consume:
  - /scoreboard  → live + scheduled + finished matches for the current day
  - /standings   → group tables

ESPN updates the scoreboard roughly every 20-30s during live play, so we
cache the scoreboard briefly (live polling stays cheap but fresh) and the
standings longer (they only change at full-time). Parsing is defensive —
ESPN's shapes drift, and a missing field must degrade to None, never 500.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from . import cache, oddsapi

# US Pacific across the whole 2026 WC window (Jun 11 – Jul 19, all PDT = UTC-7).
# The owner is on the West Coast, so "today/tomorrow" rolls at Pacific midnight.
# Fixed offset → no tzdata dependency.
_PT = timezone(timedelta(hours=-7))


def _pt_day(iso: str | None) -> str | None:
    """ISO timestamp → YYYY-MM-DD in US Pacific (the matchday boundary)."""
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.astimezone(_PT).date().isoformat()


BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world"
# Standings live under the v2 core path, not the site path.
STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings"
# Core API exposes per-provider odds, including a "Live Odds" provider with
# in-play prices. The `site` summary endpoint only carries the kickoff line.
ODDS_CORE = "https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world"
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
    """Yesterday's, today's, and tomorrow's matches, grouped by US-Pacific
    matchday (the owner's timezone). ESPN's default scoreboard rolls forward to
    whatever it deems the current slate, so we request an explicit
    [yesterday, tomorrow] range and bucket by Pacific day. Cached 20s."""

    async def fetch() -> dict[str, Any]:
        today = datetime.now(_PT).date()
        yesterday = today - timedelta(days=1)
        tomorrow = today + timedelta(days=1)
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                f"{BASE}/scoreboard",
                params={"dates": f"{yesterday:%Y%m%d}-{tomorrow:%Y%m%d}"},
            )
            r.raise_for_status()
            body = r.json() or {}
        events = [_parse_event(e) for e in (body.get("events") or [])]
        # Live first, then scheduled (by kickoff), then finished.
        order = {"in": 0, "pre": 1, "post": 2}
        events.sort(key=lambda e: (order.get(e.get("state"), 3), e.get("date") or ""))

        # Keep only yesterday / today / tomorrow (Pacific), grouped + labeled.
        labels = {
            yesterday.isoformat(): "Yesterday",
            today.isoformat(): "Today",
            tomorrow.isoformat(): "Tomorrow",
        }
        by_day: dict[str, list[dict[str, Any]]] = {}
        for e in events:
            d = _pt_day(e.get("date"))
            if d in labels:
                by_day.setdefault(d, []).append(e)
        days = [{"date": d, "label": labels[d], "events": by_day[d]} for d in sorted(by_day)]
        kept = [e for grp in days for e in grp["events"]]

        league = (body.get("leagues") or [{}])[0]
        return {
            "season": league.get("season", {}).get("displayName") or league.get("name"),
            "events": kept,
            "live_count": sum(1 for e in kept if e.get("state") == "in"),
            "days": days,
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


# ESPN tags each knockout fixture with season.slug. Order + display labels.
# Before the group stage ends the matches exist as placeholders (e.g.
# "Group A 2nd Place" vs "Group B 2nd Place") and fill in with real teams as
# results land — so the bracket is correct now and auto-populates.
_KO_ROUNDS: list[tuple[str, str]] = [
    ("round-of-32", "Round of 32"),
    ("round-of-16", "Round of 16"),
    ("quarterfinals", "Quarterfinals"),
    ("semifinals", "Semifinals"),
    ("3rd-place-match", "Third place"),
    ("final", "Final"),
]
# Whole knockout window (FIFA-fixed). Slightly padded on both ends.
_KO_DATE_RANGE = "20260626-20260720"


async def bracket() -> dict[str, Any]:
    """Knockout bracket: rounds (R32 → Final) each with their matches.
    Cached 60s so scores feel live on match days without hammering ESPN."""

    async def fetch() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(f"{BASE}/scoreboard", params={"dates": _KO_DATE_RANGE})
            r.raise_for_status()
            body = r.json() or {}
        by_slug: dict[str, list[dict[str, Any]]] = {}
        for ev in body.get("events") or []:
            slug = (ev.get("season") or {}).get("slug")
            if not slug:
                continue
            by_slug.setdefault(slug, []).append(_parse_event(ev))
        rounds = []
        for slug, label in _KO_ROUNDS:
            matches = by_slug.get(slug)
            if not matches:
                continue
            matches.sort(key=lambda m: m.get("date") or "")
            rounds.append({"slug": slug, "label": label, "matches": matches})
        return {"rounds": rounds}

    return await cache.aget_or_set("worldcup:bracket", fetch, ttl_seconds=60)


def _scorer_row(rank: int, leader: dict[str, Any]) -> dict[str, Any]:
    a = leader.get("athlete") or {}
    team = a.get("team") or {}
    logo = None
    logos = team.get("logos") or []
    if logos:
        logo = logos[0].get("href")
    logo = logo or team.get("logo")
    # displayValue looks like "Matches: 3, Goals: 2" — pull matches for a
    # goals-per-match read without a second request.
    matches = None
    dv = leader.get("displayValue") or ""
    if "Matches:" in dv:
        try:
            matches = int(dv.split("Matches:")[1].split(",")[0].strip())
        except (ValueError, IndexError):
            matches = None
    return {
        "rank": rank,
        "name": a.get("displayName"),
        "short_name": a.get("shortName"),
        "jersey": a.get("jersey"),
        "team": team.get("displayName"),
        "team_abbr": team.get("abbreviation"),
        "team_logo": logo,
        "value": int(leader.get("value") or 0),
        "matches": matches,
    }


async def scorers(limit: int = 20) -> dict[str, Any]:
    """Golden Boot race — top goal scorers + assist leaders. ESPN's free
    feed has no outright/futures odds, so this is stats only. Cached 2 min."""

    async def fetch() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(f"{BASE}/statistics")
            r.raise_for_status()
            body = r.json() or {}
        by_name: dict[str, list[dict[str, Any]]] = {}
        for cat in body.get("stats") or []:
            leaders = cat.get("leaders") or []
            by_name[cat.get("name")] = [
                _scorer_row(i + 1, ld) for i, ld in enumerate(leaders[:limit])
            ]
        return {
            "goals": by_name.get("goalsLeaders", []),
            "assists": by_name.get("assistsLeaders", []),
        }

    return await cache.aget_or_set(f"worldcup:scorers:{limit}", fetch, ttl_seconds=120)


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
    used_live = False

    def side(name: str) -> str | None:
        # ESPN's free summary feed carries a live in-play price ("current")
        # only intermittently; when present we prefer it, else fall back to
        # the closing (kickoff) line, then the opening line. We track whether
        # a live value was actually used so the UI can label it honestly
        # rather than claiming "live" when it's really the kickoff line.
        nonlocal used_live
        o = ml.get(name) or {}
        cur = o.get("current")
        if cur and cur.get("odds"):
            used_live = True
            return cur.get("odds")
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
        # True only when the numbers above are the live in-play line.
        "is_live": used_live,
    }


def _american(side: dict[str, Any]) -> str | None:
    """American-odds string for one outcome of a core-API odds provider.
    Prefers the live `current` moneyline, else the provider's top-level one."""
    cur = side.get("current") or {}
    m = cur.get("moneyLine")
    if isinstance(m, dict):
        if m.get("american"):
            return m["american"]
        v = m.get("value")
    else:
        v = m
    if v is None:
        v = side.get("moneyLine")
    if not isinstance(v, (int, float)):
        return None
    n = int(round(v))
    return f"+{n}" if n > 0 else str(n)


async def _core_odds(client: httpx.AsyncClient, event_id: str) -> dict[str, Any] | None:
    """Live in-play odds from the core API's 'Live Odds' provider, falling
    back to the standard (kickoff) provider. The summary feed only has the
    kickoff line, so this is what makes the modal's odds actually move during
    a match. ESPN's public live line lags its own widget by a few minutes —
    the UI flags that. Returns None to let the caller fall back to summary."""
    try:
        r = await client.get(f"{ODDS_CORE}/events/{event_id}/competitions/{event_id}/odds")
        r.raise_for_status()
        items = (r.json() or {}).get("items") or []
    except Exception:
        return None
    if not items:
        return None
    live = next(
        (it for it in items if "live" in ((it.get("provider") or {}).get("name") or "").lower()),
        None,
    )
    main = next((it for it in items if str((it.get("provider") or {}).get("id")) == "100"), None)
    src = live or main or items[0]
    # The provider's odds usually sit behind a $ref; follow it for fresh data.
    ref = src.get("$ref")
    if ref:
        try:
            src = (await client.get(ref)).json()
        except Exception:
            pass
    home = _american(src.get("homeTeamOdds") or {})
    draw = _american(src.get("drawOdds") or {})
    away = _american(src.get("awayTeamOdds") or {})
    if not (home or draw or away):
        return None
    return {
        "provider": (src.get("provider") or {}).get("name"),
        "details": src.get("details"),
        "over_under": src.get("overUnder"),
        "spread": src.get("spread"),
        "moneyline": {"home": home, "draw": draw, "away": away},
        "is_live": bool(live),
    }


def _implied_prob(american: str | None) -> float | None:
    """American moneyline → implied win probability (0-1), incl. the vig."""
    if not american:
        return None
    try:
        n = int(str(american).replace("+", ""))
    except ValueError:
        return None
    if n == 0:
        return None
    return 100.0 / (n + 100.0) if n > 0 else (-n) / (-n + 100.0)


def _movement(live_ml: dict[str, Any] | None, kickoff_ml: dict[str, Any] | None) -> dict[str, str]:
    """Per-outcome odds drift since kickoff: 'shorten' (more likely now),
    'drift' (less likely), or 'flat'. The DIRECTION aggregates sharp money —
    a strong in-play signal on top of the raw price."""
    out: dict[str, str] = {}
    if not (live_ml and kickoff_ml):
        return out
    for k in ("home", "draw", "away"):
        pl, pk = _implied_prob(live_ml.get(k)), _implied_prob(kickoff_ml.get(k))
        if pl is None or pk is None:
            continue
        diff = pl - pk
        out[k] = "shorten" if diff > 0.03 else "drift" if diff < -0.03 else "flat"
    return out


# WMO weather codes → short label (Open-Meteo). Enough buckets to read at a glance.
_WMO: dict[int, str] = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Cloudy",
    45: "Fog",
    48: "Fog",
    51: "Drizzle",
    53: "Drizzle",
    55: "Drizzle",
    61: "Rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Snow",
    80: "Showers",
    81: "Showers",
    82: "Heavy showers",
    95: "Thunderstorm",
    96: "Thunderstorm",
    99: "Thunderstorm",
}


async def _weather(client: httpx.AsyncClient, city: str | None) -> dict[str, Any] | None:
    """Current conditions at the venue city via Open-Meteo (free, no key).
    Heat is genuinely predictive at the 2026 US summer World Cup — afternoon
    games in TX/FL/Monterrey run 35C+, slowing tempo and late goals."""
    if not city:
        return None
    name = city.split(",")[0].strip()

    async def fetch() -> dict[str, Any] | None:
        try:
            g = await client.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": name, "count": 1},
            )
            results = (g.json() or {}).get("results") or []
            if not results:
                return None
            lat, lon = results[0].get("latitude"), results[0].get("longitude")
            w = await client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "current": "temperature_2m,weather_code,wind_speed_10m",
                },
            )
            cur = (w.json() or {}).get("current") or {}
        except Exception:
            return None
        temp_c = cur.get("temperature_2m")
        if temp_c is None:
            return None
        code = int(cur.get("weather_code") or 0)
        return {
            "temp_c": round(float(temp_c)),
            "temp_f": round(float(temp_c) * 9 / 5 + 32),
            "desc": _WMO.get(code, "—"),
            "wind_kmh": round(float(cur.get("wind_speed_10m") or 0)),
            "hot": float(temp_c) >= 30,
        }

    return await cache.aget_or_set(f"wc-weather:{name}", fetch, ttl_seconds=1800)


def _group_position(summary: dict[str, Any], team_id: str | None) -> dict[str, Any] | None:
    """Team's current group rank/points from the standings embedded in the
    match summary — the 'what's at stake' context for a group-stage game."""
    if not team_id:
        return None
    groups = (summary.get("standings") or {}).get("groups") or []
    for g in groups:
        entries = ((g.get("standings") or {}).get("entries")) or []
        for e in entries:
            # In the summary feed the entry's team id sits at e["id"]
            # (e["team"] is just the display name string).
            if str(e.get("id")) == str(team_id):
                return {
                    "group": g.get("header") or g.get("name"),
                    "rank": _stat(e, "rank"),
                    "points": _stat(e, "points"),
                    "played": _stat(e, "gamesPlayed"),
                }
    return None


def _did_sub(v: Any) -> bool:
    """ESPN encodes sub status as {"didSub": bool} (and not-yet-played matches
    set it on every player), so a plain truthiness check flags everyone. Read
    the didSub flag; fall back to truthiness for the occasional bare value."""
    if isinstance(v, dict):
        return bool(v.get("didSub"))
    return bool(v)


def _lineup(rosters: list[dict[str, Any]], home_away: str) -> dict[str, Any] | None:
    """One team's formation + starting XI (and subs used) from the summary's
    `rosters`. Only populated once ESPN publishes team news (~1h pre-kickoff);
    returns None before then so pre-match reads degrade gracefully."""
    r = next((x for x in rosters if x.get("homeAway") == home_away), None)
    if not r:
        return None
    starters: list[dict[str, Any]] = []
    subs_in: list[dict[str, Any]] = []
    for p in r.get("roster") or []:
        ath = p.get("athlete") or {}
        name = ath.get("displayName") or ath.get("shortName")
        if not name:
            continue
        pos = (p.get("position") or {}).get("abbreviation") or (ath.get("position") or {}).get(
            "abbreviation"
        )
        if p.get("starter"):
            starters.append({"name": name, "pos": pos, "subbed_out": _did_sub(p.get("subbedOut"))})
        elif _did_sub(p.get("subbedIn")):
            subs_in.append({"name": name, "pos": pos})
    if not (r.get("formation") or starters):
        return None
    return {"formation": r.get("formation"), "starters": starters, "subs_in": subs_in}


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


# ODDS_CORE already ends in ".../leagues/fifa.world".
_TEAM_STATS_URL = ODDS_CORE + "/seasons/2026/types/1/teams/{tid}/statistics"


async def _team_stats(team_id: str | None) -> dict[str, Any] | None:
    """A team's aggregated 2026 World Cup stats (record, goals, corners, shots,
    xG, cards, clean sheets) from ESPN's core season-statistics feed — the
    tournament form a bettor wants. Cached 10 min (only moves at full-time).
    Returns None if unavailable so the modal degrades gracefully."""
    if not team_id:
        return None

    async def fetch() -> dict[str, Any] | None:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                r = await client.get(_TEAM_STATS_URL.format(tid=team_id))
                r.raise_for_status()
                cats = ((r.json() or {}).get("splits") or {}).get("categories") or []
        except Exception:
            return None
        vals: dict[str, Any] = {}
        for c in cats:
            for st in c.get("stats") or []:
                n = st.get("name")
                if n is not None:
                    vals[n] = st.get("value")
        mp = vals.get("appearances")
        if not mp:
            return None
        mp = int(mp)

        def pg(name: str) -> float | None:  # per-game
            v = vals.get(name)
            return round(v / mp, 1) if isinstance(v, (int, float)) and mp else None

        def iv(name: str) -> int | None:  # int value
            v = vals.get(name)
            return int(round(v)) if isinstance(v, (int, float)) else None

        def r2(name: str) -> float | None:  # 2-decimal value
            v = vals.get(name)
            return round(v, 2) if isinstance(v, (int, float)) else None

        return {
            "matches": mp,
            "record": f"{iv('wins') or 0}-{iv('draws') or 0}-{iv('losses') or 0}",
            "gf": iv("totalGoals"),
            "ga": iv("goalsConceded"),
            "gf_pg": pg("totalGoals"),
            "ga_pg": pg("goalsConceded"),
            "xg_pg": r2("avgExpectedGoals"),
            "xga_pg": r2("avgExpectedGoalsConceded"),
            "shots_pg": pg("totalShots"),
            "sot_pg": pg("shotsOnTarget"),
            "corners_pg": pg("wonCorners"),
            "corners_against_pg": pg("lostCorners"),
            "possession": iv("possessionPct"),
            "yellow": iv("yellowCards") or 0,
            "red": iv("redCards") or 0,
            "clean_sheets": iv("cleanSheet") or 0,
        }

    return await cache.aget_or_set(f"wc-teamstats:{team_id}", fetch, ttl_seconds=600)


async def match(event_id: str) -> dict[str, Any]:
    """Full match detail: live team stats (corners, possession, shots, …),
    betting odds, and goal/card events. Cached 15s for live polling."""

    async def fetch() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(f"{BASE}/summary", params={"event": event_id})
            r.raise_for_status()
            s = r.json() or {}
            # Prefer the core API's live in-play line; fall back to the
            # summary's kickoff line when the live provider isn't available.
            core = await _core_odds(client, event_id)
            city = (((s.get("gameInfo") or {}).get("venue") or {}).get("address") or {}).get("city")
            weather = await _weather(client, city)

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

        # Real-time sportsbook line (The Odds API) when configured + in quota,
        # else ESPN's live-but-laggy provider, else the kickoff line.
        book_odds = None
        games = await oddsapi.h2h_games()
        if games:
            book_odds = oddsapi.match_moneyline(
                games, (home or {}).get("name"), (away or {}).get("name")
            )

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

        # Resolve the displayed odds + attach movement vs the kickoff line.
        kickoff = _odds(s)
        live = book_odds or core
        if live and live.get("moneyline"):
            live = {
                **live,
                "movement": _movement(live["moneyline"], (kickoff or {}).get("moneyline")),
                "kickoff": (kickoff or {}).get("moneyline"),
            }
        odds_final = live or kickoff

        # Game-state context: each side's group position (group stage only).
        if home:
            home["group_pos"] = _group_position(s, home.get("id"))
        if away:
            away["group_pos"] = _group_position(s, away.get("id"))

        # Formation + starting XI per team (once team news is published).
        rosters = s.get("rosters") or []
        if home:
            home["lineup"] = _lineup(rosters, "home")
        if away:
            away["lineup"] = _lineup(rosters, "away")

        # Each side's aggregated tournament form (goals, corners, shots, xG,
        # cards) — betting context. Fetched concurrently; cached 10 min each.
        h_form, a_form = await asyncio.gather(
            _team_stats((home or {}).get("id")),
            _team_stats((away or {}).get("id")),
        )
        if home:
            home["tournament"] = h_form
        if away:
            away["tournament"] = a_form

        return {
            "id": event_id,
            "state": status.get("state"),
            "status_detail": status.get("shortDetail") or status.get("detail"),
            "venue": (comp.get("venue") or {}).get("fullName"),
            "home": home,
            "away": away,
            "stats": stats,
            "odds": odds_final,
            "weather": weather,
            "events": _key_events(s),
        }

    return await cache.aget_or_set(f"worldcup:match:{event_id}", fetch, ttl_seconds=15)
