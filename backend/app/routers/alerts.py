"""Price alerts — owner sets a (symbol, direction, threshold) tuple, the
background evaluator marks it triggered when the last trade crosses the
threshold, and the frontend pops a browser notification on next poll.

Owner-only writes (POST/DELETE). Reads are also owner-gated since they
expose the owner's watch list.
"""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import PriceAlert
from ..services import alerts_runner

router = APIRouter(prefix="/alerts", tags=["alerts"])

VALID_DIRECTIONS = {"above", "below"}


class AlertIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)
    direction: str = Field(default="above")
    threshold: float
    note: str | None = None


def _require_owner(request: Request) -> None:
    from ..main import is_guest

    if is_guest(request):
        raise HTTPException(status_code=401, detail="owner login required")


def _row_to_dict(r: PriceAlert) -> dict[str, Any]:
    def iso_utc(d: datetime | None) -> str | None:
        if d is None:
            return None
        s = d.isoformat()
        return s if s.endswith("Z") or "+" in s else s + "Z"

    return {
        "id": r.id,
        "symbol": r.symbol,
        "direction": r.direction,
        "threshold": r.threshold,
        "note": r.note,
        "created_at": iso_utc(r.created_at),
        "triggered_at": iso_utc(r.triggered_at),
        "triggered_price": r.triggered_price,
        "dismissed_at": iso_utc(r.dismissed_at),
    }


@router.get("")
def list_alerts(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    _require_owner(request)
    # Active alerts (not yet triggered) + recently-triggered/dismissed for
    # history. Newest-first.
    rows = db.execute(select(PriceAlert).order_by(desc(PriceAlert.id)).limit(100)).scalars().all()
    le = alerts_runner.last_evaluated_at
    le_iso = (
        (le.isoformat() + "Z")
        if le and "+" not in le.isoformat()
        else (le.isoformat() if le else None)
    )
    return {
        "alerts": [_row_to_dict(r) for r in rows],
        # When the evaluator last completed a tick. Stalls (Render free-tier
        # sleep) show up as this going stale — the UI warns past ~5 min.
        "last_evaluated_at": le_iso,
    }


@router.post("")
def create_alert(
    payload: AlertIn, request: Request, db: Session = Depends(get_db)
) -> dict[str, Any]:
    _require_owner(request)
    if payload.direction not in VALID_DIRECTIONS:
        raise HTTPException(status_code=400, detail=f"direction must be one of {VALID_DIRECTIONS}")
    if payload.threshold <= 0:
        raise HTTPException(status_code=400, detail="threshold must be > 0")
    row = PriceAlert(
        symbol=payload.symbol.strip().upper(),
        direction=payload.direction,
        threshold=float(payload.threshold),
        note=(payload.note or None),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_to_dict(row)


@router.delete("/{alert_id}")
def delete_alert(alert_id: int, request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    _require_owner(request)
    row = db.get(PriceAlert, alert_id)
    if row is None:
        raise HTTPException(status_code=404, detail="alert not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/{alert_id}/dismiss")
def dismiss_alert(alert_id: int, request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    _require_owner(request)
    row = db.get(PriceAlert, alert_id)
    if row is None:
        raise HTTPException(status_code=404, detail="alert not found")
    row.dismissed_at = datetime.utcnow()
    db.commit()
    return _row_to_dict(row)
