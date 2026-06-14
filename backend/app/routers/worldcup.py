"""2026 FIFA World Cup — public sports data (no auth). Live scoreboard +
group standings sourced from ESPN. Both degrade to a warning string if ESPN
is unreachable so the tab never hard-errors."""

from typing import Any

from fastapi import APIRouter

from ..services import worldcup
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


@router.get("/bracket")
async def bracket() -> dict[str, Any]:
    try:
        return await worldcup.bracket()
    except Exception as e:
        return {"rounds": [], "warning": provider_error("ESPN", e)}
