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
    econ_end_iso = (datetime.utcnow() + timedelta(days=10)).strftime("%Y-%m-%d")
    earnings_end_iso = (datetime.utcnow() + timedelta(days=20)).strftime("%Y-%m-%d")

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
        if not when or when < today_iso or when > econ_end_iso:
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
        earn_raw = await finnhub.earnings_calendar(days_ahead=20)
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
        if d and d > earnings_end_iso:
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


# Curated list of high-profile rumored / anticipated IPOs that don't appear
# on Finnhub's calendar yet (no S-1 filed, no fixed date) but are heavily
# watched by the market. Each entry pairs the company with related public
# tickers that historically move in sympathy when the IPO narrative shifts
# — useful for the user to spot a "pre-IPO" entry point without buying
# private shares.
#
# Edit this list as filings / news shift. Don't bake in price predictions
# or "expected dates" with high confidence; treat est_timing as rumor.
WATCHED_RUMORED_IPOS: list[dict[str, Any]] = [
    {
        "name": "SpaceX",
        "sector": "Space / aerospace",
        "est_valuation_usd": "$350-400B",
        "est_timing": "2026 (rumored, no S-1 filed)",
        "why_it_matters": (
            "Would be the largest IPO in history. Sets the public-market "
            "valuation anchor for the entire space economy. Starlink alone "
            "is rumored to be carved out separately."
        ),
        "related_tickers": ["RKLB", "ASTS", "LUNR", "RDW", "BA"],
    },
    {
        "name": "Stripe",
        "sector": "Fintech / payments",
        "est_valuation_usd": "$70-100B",
        "est_timing": "2026 (long-rumored, employee tender at $91.5B in 2025)",
        "why_it_matters": (
            "Largest private payments processor. Public listing would reset "
            "the fintech sector's multiples. Bellwether for PYPL / SQ / "
            "ADYEY."
        ),
        "related_tickers": ["PYPL", "SQ", "V", "MA"],
    },
    {
        "name": "Databricks",
        "sector": "AI / data infrastructure",
        "est_valuation_usd": "$60-70B",
        "est_timing": "2026 (Series J at $62B, S-1 rumors)",
        "why_it_matters": (
            "Direct comp for Snowflake. An IPO would crystallize the enterprise "
            "AI-infra premium and likely re-rate SNOW / MDB / PLTR."
        ),
        "related_tickers": ["SNOW", "MDB", "PLTR", "DDOG"],
    },
    {
        "name": "Klarna",
        "sector": "Fintech / BNPL",
        "est_valuation_usd": "$15-20B",
        "est_timing": "F-1 filed 2025, listing pending",
        "why_it_matters": (
            "BNPL bellwether — KLAR's pricing will signal whether the sector "
            "has recovered from the 2022-23 valuation crash. Watched closely "
            "by AFRM holders."
        ),
        "related_tickers": ["AFRM", "PYPL", "SQ"],
    },
    {
        "name": "Discord",
        "sector": "Consumer social",
        "est_valuation_usd": "$15B",
        "est_timing": "2026 (rumored, no S-1)",
        "why_it_matters": (
            "Rare standalone consumer-social IPO since Reddit. Pricing will "
            "set expectations for the next wave of community-platform listings."
        ),
        "related_tickers": ["RDDT", "META", "PINS"],
    },
    {
        "name": "Anthropic",
        "sector": "AI labs",
        "est_valuation_usd": "$60B+ (private)",
        "est_timing": "No timeline (PBC structure complicates a traditional IPO)",
        "why_it_matters": (
            "If/when it lists, it would be the first pure-play AI-lab public "
            "comp alongside the Microsoft-tied OpenAI structure. Indirect "
            "exposure today via cloud and hyperscaler stocks."
        ),
        "related_tickers": ["GOOGL", "MSFT", "AMZN", "NVDA"],
    },
]


@router.get("/ipos")
async def ipos(days_ahead: int = 30) -> dict[str, Any]:
    """Upcoming IPO calendar — confirmed (from Finnhub) + curated rumored
    mega-IPOs (hardcoded server-side, edited via WATCHED_RUMORED_IPOS).

    `days_ahead` only filters the confirmed list (rumored entries have no
    fixed date so they're always returned)."""
    try:
        confirmed_raw = await finnhub.ipo_calendar(days_ahead=days_ahead)
        confirmed_warning: str | None = None
    except RuntimeError as e:
        confirmed_raw = []
        confirmed_warning = str(e)
    except Exception as e:
        confirmed_raw = []
        confirmed_warning = f"Finnhub error: {e}"

    confirmed: list[dict[str, Any]] = []
    for row in confirmed_raw:
        confirmed.append(
            {
                "date": row.get("date"),
                "name": row.get("name"),
                "symbol": row.get("symbol"),
                "exchange": row.get("exchange"),
                "price_range": row.get("price"),
                "shares": row.get("numberOfShares"),
                "total_value_usd": row.get("totalSharesValue"),
                "status": row.get("status"),
            }
        )
    confirmed.sort(key=lambda x: x.get("date") or "")

    return {
        "confirmed": confirmed,
        "confirmed_warning": confirmed_warning,
        "rumored": WATCHED_RUMORED_IPOS,
    }
