"""Claude-powered match-prediction brief for the World Cup tab.

On demand (user clicks "Analyze with Claude" in the match modal), we hand
Claude the live data we already pull in `worldcup.match()` — both teams, the
score/state, each side's group position, the current sportsbook moneyline and
how it has moved since kickoff, venue weather, and live in-match stats — and
ask for a tight scouting brief plus a prediction lean.

Design notes:
  - Gated on ANTHROPIC_API_KEY. No key → a `warning` string, never an error.
  - The Anthropic SDK is imported lazily so a missing dependency or unset key
    can never break app boot or the rest of the World Cup tab.
  - Structured output (json_schema) so the frontend gets a clean object.
  - Cached per (event_id, match-state) so repeated modal opens are free, but a
    live match re-analyzes once the score/clock actually moves.
  - Honest framing: Claude has no in-tournament news beyond the data we pass,
    so the prompt forbids inventing injuries/lineups/results and tells it to
    lean on the market line + team-strength priors and flag thin reads.
"""

from typing import Any

from ..config import get_settings
from . import cache
from .errors import provider_error

# Cache the (expensive) Claude call for 30 min; the state token in the key
# forces a refresh sooner whenever the score/clock changes on a live match.
_TTL_SECONDS = 1800
# Generous headroom: adaptive thinking tokens count against max_tokens, and a
# truncated response would fail JSON parsing. The brief itself is small.
_MAX_TOKENS = 6000

_SYSTEM = """You are an expert football (soccer) analyst helping a bettor form a quick, \
decision-useful read on a 2026 FIFA World Cup match. You are given structured live data: \
the two teams, the score and match state, each side's current group standing, the \
sportsbook moneyline (and how it has moved since kickoff), venue weather, and live \
in-match stats.

Write a tight scouting brief, not an essay. Ground every claim in the data provided plus \
well-established, durable team-strength priors. The sportsbook moneyline is the market's \
consensus probability — respect it: a heavy favorite is a heavy favorite, and your job is \
to explain *why* structurally and whether the live data supports or undercuts the price. \
Odds that have shortened since kickoff mean money/momentum is moving that way; odds that \
have drifted mean the opposite.

Be honest about uncertainty. You do NOT have in-tournament news — injuries, suspensions, \
confirmed lineups, or other recent results — beyond what is in the data. Never invent \
player names, injuries, suspensions, or results that are not present in the data. When the \
data is thin (e.g. a pre-match game with no stats), say so and rate the read low-confidence \
rather than fabricating specifics.

Also give a read on two secondary betting markets:
- markets.total_goals: lean over or under the posted goals line (the "Total goals O/U" in \
the data). If a live match, factor the current score, minute, and remaining time into the \
pace. If no line is given, estimate the expected total and lean relative to a 2.5 line. Put \
the line you reasoned against in `line` (or "n/a"), and explain the pace logic in `note`.
- markets.corners: a corners total is NOT in the data, so estimate the projected full-match \
total corners from both teams' attacking style and (if live) the current corner count + \
minute. Put a number or tight range in `projected_total`, set `lean` to over/under a typical \
World Cup line (~9.5-10.5) or "no edge", and justify in `note`. Be explicit this is an \
estimate, not a posted line.
For either market, use lean "no edge" when the data doesn't support a confident side.

Keep each team summary to 2-3 sentences. strengths and risks: 2-3 short phrases each. \
key_factors: 2-4 punchy bullets that actually drive your lean. watch: one sentence on the \
single most informative thing to watch to update the read in-play. lean is your pick for \
the most likely result (home/away/draw), or "toss-up" when it is genuinely too close. Keep \
every note to one sentence."""

_TEAM_BRIEF = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "risks": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "strengths", "risks"],
    "additionalProperties": False,
}

_GOALS_MARKET = {
    "type": "object",
    "properties": {
        "line": {"type": "string"},  # the O/U line reasoned against, e.g. "2.5" or "n/a"
        "lean": {"type": "string", "enum": ["over", "under", "no edge"]},
        "note": {"type": "string"},
    },
    "required": ["line", "lean", "note"],
    "additionalProperties": False,
}

_CORNERS_MARKET = {
    "type": "object",
    "properties": {
        "projected_total": {"type": "string"},  # estimate, e.g. "9-11"
        "lean": {"type": "string", "enum": ["over", "under", "no edge"]},
        "note": {"type": "string"},
    },
    "required": ["projected_total", "lean", "note"],
    "additionalProperties": False,
}

_MARKETS = {
    "type": "object",
    "properties": {"total_goals": _GOALS_MARKET, "corners": _CORNERS_MARKET},
    "required": ["total_goals", "corners"],
    "additionalProperties": False,
}

_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "lean": {"type": "string", "enum": ["home", "away", "draw", "toss-up"]},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "home": _TEAM_BRIEF,
        "away": _TEAM_BRIEF,
        "key_factors": {"type": "array", "items": {"type": "string"}},
        "markets": _MARKETS,
        "watch": {"type": "string"},
    },
    "required": [
        "headline",
        "lean",
        "confidence",
        "home",
        "away",
        "key_factors",
        "markets",
        "watch",
    ],
    "additionalProperties": False,
}


def _fmt_side(side: dict[str, Any] | None) -> str:
    if not side:
        return "TBD"
    pos = side.get("group_pos") or {}
    bits = [side.get("name") or "TBD"]
    if pos.get("group") is not None:
        rank = pos.get("rank")
        pts = pos.get("points")
        played = pos.get("played")
        seg = f"{pos['group']}"
        if rank is not None:
            seg += f", {int(rank)}{_ordinal_suffix(int(rank))}"
        if pts is not None:
            seg += f", {int(pts)} pts"
        if played is not None:
            seg += f" in {int(played)} played"
        bits.append(f"({seg})")
    return " ".join(bits)


def _ordinal_suffix(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


def _state_word(state: str | None) -> str:
    return {"pre": "scheduled (not started)", "in": "LIVE", "post": "finished"}.get(
        state or "", "unknown"
    )


def _build_context(detail: dict[str, Any]) -> str:
    home, away = detail.get("home"), detail.get("away")
    lines: list[str] = []
    lines.append(f"Match state: {_state_word(detail.get('state'))}")
    if detail.get("status_detail"):
        lines.append(f"Status: {detail['status_detail']}")
    if detail.get("venue"):
        lines.append(f"Venue: {detail['venue']}")
    lines.append(f"Home: {_fmt_side(home)}")
    lines.append(f"Away: {_fmt_side(away)}")
    if detail.get("state") in ("in", "post"):
        hs = (home or {}).get("score")
        as_ = (away or {}).get("score")
        lines.append(
            f"Score: {(home or {}).get('abbr') or 'home'} "
            f"{int(hs) if hs is not None else '–'} : "
            f"{int(as_) if as_ is not None else '–'} "
            f"{(away or {}).get('abbr') or 'away'}"
        )

    odds = detail.get("odds") or {}
    ml = odds.get("moneyline") or {}
    if any(ml.values()):
        label = "live in-play" if odds.get("is_live") else "kickoff"
        prov = odds.get("provider") or "book"
        lines.append(
            f"Moneyline ({label}, {prov}): home {ml.get('home') or '—'}, "
            f"draw {ml.get('draw') or '—'}, away {ml.get('away') or '—'}"
        )
        mv = odds.get("movement") or {}
        moves = [f"{k} {v}" for k, v in mv.items() if v and v != "flat"]
        if moves:
            lines.append(
                f"Odds movement since kickoff: {', '.join(moves)} "
                "(shorten = more likely now, drift = less likely)"
            )
        if odds.get("over_under") is not None:
            lines.append(f"Total goals O/U: {odds['over_under']}")

    wx = detail.get("weather") or {}
    if wx.get("temp_f") is not None:
        hot = " — hot (slower tempo, late fatigue a factor)" if wx.get("hot") else ""
        lines.append(
            f"Weather: {wx['temp_f']}°F, {wx.get('desc') or '—'}, "
            f"wind {wx.get('wind_kmh')} km/h{hot}"
        )

    stats = detail.get("stats") or []
    if stats:
        lines.append("Live stats (home vs away):")
        for s in stats:
            suf = s.get("suffix") or ""
            lines.append(
                f"  - {s.get('label')}: {s.get('home') or '0'}{suf} vs "
                f"{s.get('away') or '0'}{suf}"
            )

    # Running totals to anchor the goals-pace and corners-pace estimates.
    if detail.get("state") == "in":
        hs, as_ = (home or {}).get("score"), (away or {}).get("score")
        pace = []
        if detail.get("status_detail"):
            pace.append(f"{detail['status_detail']} elapsed")
        if hs is not None and as_ is not None:
            pace.append(f"goals so far {int(hs + as_)}")
        corners = next((s for s in stats if s.get("label") == "Corners"), None)
        if corners:
            ct = (corners.get("home_num") or 0) + (corners.get("away_num") or 0)
            pace.append(f"corners so far {int(ct)}")
        if pace:
            lines.append("Pace: " + ", ".join(pace) + " (extrapolate to full-time)")

    events = detail.get("events") or []
    if events:
        lines.append("Key events (latest first):")
        for e in events[:8]:
            clk = e.get("clock") or ""
            lines.append(
                f"  - {clk} {e.get('team_abbr') or ''} {e.get('type') or ''}"
                f"{(' — ' + e['text']) if e.get('text') else ''}".strip()
            )

    return "\n".join(lines)


def _state_token(detail: dict[str, Any]) -> str:
    """Cache-key suffix: changes whenever the score or clock advances so a
    live match re-analyzes, but a static (pre/finished) match reuses the cache."""
    home, away = detail.get("home") or {}, detail.get("away") or {}
    return (
        f"{detail.get('state')}|{home.get('score')}|{away.get('score')}|"
        f"{detail.get('status_detail')}"
    )


async def analyze(event_id: str, detail: dict[str, Any]) -> dict[str, Any]:
    """Return a Claude-generated prediction brief for the match, or a
    `warning` dict when the key is unset / Claude is unavailable."""
    settings = get_settings()
    if not settings.anthropic_api_key:
        return {
            "available": False,
            "warning": "Claude analysis needs an Anthropic API key — set "
            "ANTHROPIC_API_KEY in the server environment to enable it.",
        }
    if detail.get("warning") or not (detail.get("home") and detail.get("away")):
        return {
            "available": False,
            "warning": "Match data isn't available yet — try again once the "
            "fixture is live or its lineup is set.",
        }

    home_name = (detail.get("home") or {}).get("name")
    away_name = (detail.get("away") or {}).get("name")
    cache_key = f"worldcup:analysis:{event_id}:{_state_token(detail)}"

    async def fetch() -> dict[str, Any]:
        # lazy: never block app boot
        from anthropic import AsyncAnthropic, BadRequestError

        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        # Empty env value (var created but left blank) → fall back to the default.
        model = settings.anthropic_model or "claude-opus-4-8"
        context = (
            f"Teams: {home_name} (home) vs {away_name} (away).\n\n"
            f"{_build_context(detail)}\n\n"
            "Analyze both teams and give me a prediction lean to help me bet."
        )
        system = [{"type": "text", "text": _SYSTEM, "cache_control": {"type": "ephemeral"}}]
        fmt = {"type": "json_schema", "schema": _SCHEMA}

        async def _call(thinking: bool):
            kwargs: dict[str, Any] = {
                "model": model,
                "max_tokens": _MAX_TOKENS,
                "system": system,
                "messages": [{"role": "user", "content": context}],
            }
            # Adaptive thinking + effort improve the reasoning but are rejected
            # by cheaper models (Haiku 4.5 → 400 "adaptive thinking is not
            # supported"). Try with them; on a 400 the caller retries without,
            # so any model the owner sets in ANTHROPIC_MODEL works (and new
            # models that don't support these params degrade gracefully).
            if thinking:
                kwargs["thinking"] = {"type": "adaptive"}
                kwargs["output_config"] = {"effort": "medium", "format": fmt}
            else:
                kwargs["output_config"] = {"format": fmt}
            return await client.messages.create(**kwargs)

        try:
            resp = await _call(thinking=True)
        except BadRequestError:
            resp = await _call(thinking=False)

        import json

        text = next((b.text for b in resp.content if b.type == "text"), "")
        data = json.loads(text)
        data.update(
            {
                "available": True,
                "home_team": home_name,
                "away_team": away_name,
                "model": model,
            }
        )
        return data

    try:
        return await cache.aget_or_set(cache_key, fetch, ttl_seconds=_TTL_SECONDS)
    except Exception as e:
        return {"available": False, "warning": provider_error("Claude", e)}
