from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import WatchlistTicker
from ..services import finnhub

router = APIRouter(prefix="/calendar", tags=["calendar"])


def _impact_label(raw: str | None) -> str:
    if not raw:
        return "low"
    s = str(raw).lower()
    if s in ("high", "h", "3"):
        return "high"
    if s in ("medium", "med", "m", "2"):
        return "medium"
    return "low"


@router.get("/today")
async def today(db: Session = Depends(get_db)) -> dict[str, Any]:
    watchlist = {r.symbol for r in db.query(WatchlistTicker).all()}
    today_iso = datetime.utcnow().strftime("%Y-%m-%d")
    end_iso = (datetime.utcnow() + timedelta(days=10)).strftime("%Y-%m-%d")

    econ_warning: str | None = None
    earnings_warning: str | None = None

    try:
        econ_raw = await finnhub.economic_calendar(days_ahead=10)
    except RuntimeError as e:
        econ_raw = []
        econ_warning = str(e)
    except Exception as e:
        econ_raw = []
        econ_warning = f"Finnhub error: {e}"

    # US-only, next 7 days, prefer high+medium impact (low impact floods the list).
    econ = []
    for e in econ_raw:
        if e.get("country") != "US":
            continue
        when = (e.get("time") or "")[:10]
        if not when or when < today_iso or when > end_iso:
            continue
        impact = _impact_label(e.get("impact"))
        if impact == "low" and when != today_iso:
            # Show low-impact only for today; otherwise the 7-day list is too noisy.
            continue
        econ.append(
            {
                "event": e.get("event"),
                "country": e.get("country"),
                "time": e.get("time"),
                "date": when,
                "impact": impact,
                "actual": e.get("actual"),
                "estimate": e.get("estimate"),
                "previous": e.get("prev"),
                "unit": e.get("unit"),
            }
        )
    econ.sort(key=lambda x: (x.get("time") or ""))

    try:
        earn_raw = await finnhub.earnings_calendar(days_ahead=10)
    except RuntimeError as e:
        earn_raw = []
        earnings_warning = str(e)
    except Exception as e:
        earn_raw = []
        earnings_warning = f"Finnhub error: {e}"

    earnings = []
    for e in earn_raw:
        sym = (e.get("symbol") or "").upper()
        if sym not in watchlist:
            continue
        d = e.get("date")
        if d and d > end_iso:
            continue
        earnings.append(
            {
                "symbol": sym,
                "date": d,
                "hour": e.get("hour"),  # bmo / amc
                "eps_estimate": e.get("epsEstimate"),
                "eps_actual": e.get("epsActual"),
            }
        )
    earnings.sort(key=lambda x: x.get("date") or "")

    return {
        "econ": econ,
        "earnings": earnings,
        "econ_warning": econ_warning,
        "earnings_warning": earnings_warning,
    }
