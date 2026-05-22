"""HTTP API for the SPY-divergence trading bot.

Endpoints are owner-only:
- Writes are gated by the global auth middleware (POST requires owner).
- Reads also require owner since the bot's signal/trade log is private.

  GET  /api/bot/status      → { running, last_tick, day_pnl, ... }
  POST /api/bot/start       → flips BotState.running true (refuses if not paper)
  POST /api/bot/stop        → flips BotState.running false; existing positions
                              keep being monitored until they close
  GET  /api/bot/signals     → recent signal log
  GET  /api/bot/trades      → recent trade lifecycles (paper)
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import BotSignal, BotState, BotTrade
from ..services.bot import safety

router = APIRouter(prefix="/bot", tags=["bot"])


def _require_owner(request: Request) -> None:
    """Local owner check — middleware only gates writes; we also gate reads
    here since the bot's logs are private."""
    from ..main import is_guest

    if is_guest(request):
        raise HTTPException(status_code=401, detail="owner login required")


def _state_row(db: Session) -> BotState:
    state = db.scalar(select(BotState).where(BotState.id == 1))
    if state is None:
        state = BotState(id=1, running=False)
        db.add(state)
        db.commit()
        db.refresh(state)
    return state


@router.get("/status")
def status(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    _require_owner(request)
    state = _state_row(db)
    open_count = db.scalar(
        select(BotTrade).where(BotTrade.exit_at.is_(None)).limit(1).exists().select()
    )
    return {
        "running": bool(state.running),
        "last_tick": state.last_tick.isoformat() if state.last_tick else None,
        "day_date": state.day_date,
        "day_pnl": state.day_pnl,
        "daily_loss_cap_hit": bool(state.daily_loss_cap_hit),
        "is_paper": safety.is_paper(),
        "open_position_exists": bool(open_count),
    }


@router.post("/start")
def start(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    _require_owner(request)
    if not safety.is_paper():
        raise HTTPException(
            status_code=403,
            detail="Bot refuses to start unless ALPACA_BASE_URL is the paper host.",
        )
    state = _state_row(db)
    state.running = True
    db.commit()
    return {"running": True}


@router.post("/stop")
def stop(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    _require_owner(request)
    state = _state_row(db)
    state.running = False
    db.commit()
    return {"running": False}


@router.get("/signals")
def signals(
    request: Request, limit: int = 50, db: Session = Depends(get_db)
) -> list[dict[str, Any]]:
    _require_owner(request)
    rows = db.execute(select(BotSignal).order_by(desc(BotSignal.id)).limit(limit)).scalars().all()
    return [
        {
            "id": r.id,
            "detected_at": r.detected_at.isoformat(),
            "side": r.side,
            "spot": r.spot,
            "prior_extreme_price": r.prior_extreme_price,
            "current_extreme_price": r.current_extreme_price,
            "prior_extreme_rsi": r.prior_extreme_rsi,
            "current_extreme_rsi": r.current_extreme_rsi,
            "trade_id": r.trade_id,
            "skip_reason": r.skip_reason,
        }
        for r in rows
    ]


@router.get("/trades")
def trades(
    request: Request, limit: int = 50, db: Session = Depends(get_db)
) -> list[dict[str, Any]]:
    _require_owner(request)
    rows = db.execute(select(BotTrade).order_by(desc(BotTrade.id)).limit(limit)).scalars().all()
    return [
        {
            "id": r.id,
            "signal_id": r.signal_id,
            "occ_symbol": r.occ_symbol,
            "side": r.side,
            "qty": r.qty,
            "entry_at": r.entry_at.isoformat(),
            "entry_price": r.entry_price,
            "tp_price": r.tp_price,
            "sl_price": r.sl_price,
            "exit_at": r.exit_at.isoformat() if r.exit_at else None,
            "exit_price": r.exit_price,
            "exit_reason": r.exit_reason,
            "realized_pnl": r.realized_pnl,
        }
        for r in rows
    ]
