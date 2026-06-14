"""2026 FIFA World Cup — public sports data (no auth). Live scoreboard +
group standings sourced from ESPN. Both degrade to a warning string if ESPN
is unreachable so the tab never hard-errors."""

from typing import Any

from fastapi import APIRouter

from ..services import ai_analysis, oddsapi, worldcup
from ..services.errors import provider_error

router = APIRouter(prefix="/worldcup", tags=["worldcup"])


@router.get("/scoreboard")
async def scoreboard() -> dict[str, Any]:
    try:
        return await worldcup.scoreboard()
    except Exception as e:
        return {"season": None, "events": [], "live_count": 0, "warning": provider_error("ESPN", e)}


@router.get("/standings")
async def standings() -> dict[str, Any]:
    try:
        return await worldcup.standings()
    except Exception as e:
        return {"groups": [], "warning": provider_error("ESPN", e)}


@router.get("/match/{event_id}")
async def match(event_id: str) -> dict[str, Any]:
    try:
        return await worldcup.match(event_id)
    except Exception as e:
        return {"id": event_id, "warning": provider_error("ESPN", e)}


@router.get("/match/{event_id}/analysis")
async def match_analysis(event_id: str) -> dict[str, Any]:
    """Claude-generated scouting brief + prediction lean for a match. On-demand
    (the UI calls this only when the user clicks "Analyze with Claude") because
    it costs an API call; gated on ANTHROPIC_API_KEY and degrades to a warning."""
    try:
        detail = await worldcup.match(event_id)
        return await ai_analysis.analyze(event_id, detail)
    except Exception as e:
        return {"available": False, "warning": provider_error("Claude", e)}


@router.get("/bracket")
async def bracket() -> dict[str, Any]:
    try:
        return await worldcup.bracket()
    except Exception as e:
        return {"rounds": [], "warning": provider_error("ESPN", e)}


@router.get("/scorers")
async def scorers() -> dict[str, Any]:
    try:
        return await worldcup.scorers()
    except Exception as e:
        return {"goals": [], "assists": [], "warning": provider_error("ESPN", e)}


@router.get("/title-odds")
async def title_odds() -> dict[str, Any]:
    """Tournament-winner outright odds (The Odds API). Empty when no key /
    quota — the UI shows a 'configure a key' hint in that case."""
    try:
        return await oddsapi.outright_winner()
    except Exception as e:
        return {"teams": [], "provider": None, "warning": provider_error("Odds API", e)}
