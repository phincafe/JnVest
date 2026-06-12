from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import WatchlistTicker
from ..services import finnhub
from ..services.errors import provider_error

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
        econ_warning = provider_error("Finnhub", e)

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
        earnings_warning = provider_error("Finnhub", e)

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


# Curated list of high-profile pre-IPO names the market is watching. This is
# hand-maintained — NOT a live data feed. Each entry has a `last_verified`
# date so the UI can flag staleness. Update the data + bump the date when
# filings / valuations move.
#
# `filing_status`:
#   "filed"               → public S-1 on file with SEC, listing imminent
#   "confidential_filed"  → confidential S-1 filed, public S-1 not yet posted
#   "rumored"             → no S-1, but market widely expects a listing window
#   "no_timeline"         → company has not committed to going public
#
# When a name actually lists, REMOVE it from this list — Finnhub's confirmed
# calendar will pick it up, and live trading data lives in the main app.
WATCHED_UPCOMING_IPOS: list[dict[str, Any]] = [
    {
        "name": "SpaceX",
        "sector": "Space / aerospace",
        "filing_status": "filed",
        "ticker": "SPCX",
        "est_valuation_usd": "~$1.75T target",
        "est_timing": "Listing ~June 12, 2026 (S-1 filed May 20, 2026)",
        "why_it_matters": (
            "Largest IPO in history if priced near the target. Sets the "
            "public-market valuation anchor for the entire space economy. "
            "S-1 disclosed 2025 revenue of $18.7B (Starlink: $11.4B) and a "
            "$4.94B GAAP net loss. Goldman Sachs leading a 21-bank syndicate."
        ),
        "related_tickers": ["RKLB", "ASTS", "LUNR", "RDW", "BA"],
        "source_url": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001181412",
        "last_verified": "2026-05-27",
    },
    {
        "name": "OpenAI",
        "sector": "AI labs",
        "filing_status": "confidential_filed",
        "ticker": None,
        "est_valuation_usd": "$852B – $1T+ target",
        "est_timing": "Confidential S-1 filed May 22, 2026; targeting Q3-Q4 2026 listing",
        "why_it_matters": (
            "If priced above $1T it would be the second-largest IPO ever "
            "alongside SpaceX. Last private round (Mar 2026) closed at $852B. "
            "2025 revenue $13.1B against ~$22B in spend. Goldman + Morgan "
            "Stanley leading."
        ),
        "related_tickers": ["MSFT", "NVDA", "AMD", "GOOGL", "AMZN"],
        "source_url": "https://fortune.com/2026/05/22/openai-ipo-filing-1-trillion-may-finally-answer-these-big-questions/",
        "last_verified": "2026-05-27",
    },
    {
        "name": "Discord",
        "sector": "Consumer social",
        "filing_status": "filed",
        "ticker": None,
        "est_valuation_usd": "~$15B target",
        "est_timing": "Confidential S-1 filed Jan 2026; public S-1 on file, H2 2026 target",
        "why_it_matters": (
            "Rare standalone consumer-social IPO since Reddit. ~$550M ARR. "
            "Pricing will set expectations for the next wave of community-"
            "platform listings. Goldman + JPMorgan underwriting."
        ),
        "related_tickers": ["RDDT", "META", "PINS"],
        "source_url": "https://cryptobriefing.com/discord-s-1-filing-boosts-ipo-prospects-before-2027/",
        "last_verified": "2026-05-27",
    },
    {
        "name": "Databricks",
        "sector": "AI / data infrastructure",
        "filing_status": "rumored",
        "ticker": None,
        "est_valuation_usd": "$134B (Dec 2025 Series L)",
        "est_timing": "H2 2026 expected; no S-1 on file yet",
        "why_it_matters": (
            "Direct comp for Snowflake. $4.8-5B revenue run-rate growing "
            "~55% YoY. An IPO would crystallize the enterprise AI-infra "
            "premium and likely re-rate SNOW / MDB / PLTR."
        ),
        "related_tickers": ["SNOW", "MDB", "PLTR", "DDOG"],
        "source_url": "https://www.allied.vc/articles/databricks-ipo-expectations-key-dates-valuation-risks",
        "last_verified": "2026-05-27",
    },
    {
        "name": "Stripe",
        "sector": "Fintech / payments",
        "filing_status": "no_timeline",
        "ticker": None,
        "est_valuation_usd": "~$159B (Apr 2026 tender)",
        "est_timing": "No S-1 filed; Collisons publicly resistant",
        "why_it_matters": (
            "Largest private payments processor. John Collison (early 2026): "
            "an IPO would be 'a solution in search of a problem'. If/when "
            "it lists it would reset fintech multiples — bellwether for "
            "PYPL / SQ / ADYEY."
        ),
        "related_tickers": ["PYPL", "SQ", "V", "MA", "ADYEY"],
        "source_url": "https://ipos.fyi/tracker/stripe-ipo",
        "last_verified": "2026-05-27",
    },
    {
        "name": "Anthropic",
        "sector": "AI labs",
        "filing_status": "rumored",
        "ticker": None,
        "est_valuation_usd": "$380B (Feb 2026 Series G); secondaries imply ~$1T",
        "est_timing": "Q4 2026 discussed by bankers; no S-1 filed",
        "why_it_matters": (
            "Pure-play AI lab; PBC structure complicates a traditional IPO. "
            "Run-rate revenue reportedly surpassed $30B (up from ~$9B end of "
            "2025). Bankers expect a $60B+ raise if/when it lists."
        ),
        "related_tickers": ["GOOGL", "AMZN", "MSFT", "NVDA"],
        "source_url": "https://finance.yahoo.com/news/anthropic-plans-ipo-early-2026-004854547.html",
        "last_verified": "2026-05-27",
    },
]

# Keep the old name as an alias for any external imports — will remove next
# release.
WATCHED_RUMORED_IPOS = WATCHED_UPCOMING_IPOS


@router.get("/ipos")
async def ipos(days_ahead: int = Query(30, ge=1, le=90)) -> dict[str, Any]:
    """Upcoming IPO calendar — confirmed (from Finnhub) + curated watched
    mega-IPOs (hardcoded server-side, edited via WATCHED_UPCOMING_IPOS).

    `days_ahead` only filters the confirmed list. Watched entries are always
    returned and carry a `last_verified` date so the UI can flag staleness."""
    try:
        confirmed_raw = await finnhub.ipo_calendar(days_ahead=days_ahead)
        confirmed_warning: str | None = None
    except RuntimeError as e:
        confirmed_raw = []
        confirmed_warning = str(e)
    except Exception as e:
        confirmed_raw = []
        confirmed_warning = provider_error("Finnhub", e)

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

    # Sort watched list so filed names appear first (most actionable).
    status_order = {
        "filed": 0,
        "confidential_filed": 1,
        "rumored": 2,
        "no_timeline": 3,
    }
    rumored = sorted(
        WATCHED_UPCOMING_IPOS,
        key=lambda x: status_order.get(x.get("filing_status", "rumored"), 99),
    )

    return {
        "confirmed": confirmed,
        "confirmed_warning": confirmed_warning,
        "rumored": rumored,
    }
