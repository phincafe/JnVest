"""Theme watch — curated static ticker lists evaluated through the same
"buy now / near / far" engine the Buy Watch uses.

The lists are intentionally hardcoded here so they aren't user-editable —
they're "themes" (Space, WH policy), not personal watchlists. To change a
theme, edit THEMES below and redeploy.

Each ticker is evaluated with rule="smart" + threshold=65 by default —
the unified composite buy-signal score the Buy Watch already computes.
"""

from typing import Any

from fastapi import APIRouter, HTTPException

from .. import models
from . import buy_watch as bw

router = APIRouter(prefix="/theme-watch", tags=["theme-watch"])


# Each theme is just a list of tickers — the engine picks default rule
# (smart score) + threshold (65) and computes status for each one.
# Subgroup labels carried so the UI can show "Launch & rockets" headers etc.
THEMES: dict[str, list[tuple[str, str]]] = {
    "space": [
        ("RKLB", "Launch & rockets"),
        ("ASTR", "Launch & rockets"),
        ("BA", "Launch & rockets"),
        ("ASTS", "Satellite comms"),
        ("IRDM", "Satellite comms"),
        ("VSAT", "Satellite comms"),
        ("GSAT", "Satellite comms"),
        ("PL", "Earth observation"),
        ("BKSY", "Earth observation"),
        ("SPIR", "Earth observation"),
        ("LUNR", "Lunar & deep space"),
        ("RDW", "Lunar & deep space"),
        ("MNTS", "Lunar & deep space"),
        ("LMT", "Defense primes (space)"),
        ("NOC", "Defense primes (space)"),
        ("RTX", "Defense primes (space)"),
        ("GD", "Defense primes (space)"),
        ("LDOS", "Defense primes (space)"),
        ("BWXT", "Suppliers & infrastructure"),
        ("AJRD", "Suppliers & infrastructure"),
        ("MRCY", "Suppliers & infrastructure"),
        ("TSLA", "SpaceX-adjacent hype"),
        ("PLTR", "SpaceX-adjacent hype"),
        ("STRL", "SpaceX-adjacent hype"),
    ],
    "wh": [
        ("GOOGL", "AI"),
        ("SNBI", "AI"),
        ("SIREN", "AI"),
        ("SCRVW", "AI"),
        ("TSM", "Chips"),
        ("ASML", "Chips"),
        ("NVDA", "Chips"),
        ("AMD", "Chips"),
        ("RKLB", "Space"),
        ("ASTS", "Space"),
        ("LUNR", "Space"),
        ("RDW", "Space"),
        ("COIN", "Crypto"),
        ("BTC", "Crypto"),
        ("ETH", "Crypto"),
        ("GEV", "Energy"),
        ("CEG", "Energy"),
        ("ONDS", "Drones"),
        ("CCJ", "Nuclear"),
        ("OKLO", "Nuclear"),
        ("VST", "Nuclear"),
        ("KTOS", "Defense"),
        ("SAVA", "Defense"),
        ("SAMT", "Defense"),
        ("SYM", "Robotics"),
        ("AMZN", "Robotics"),
        ("ISRG", "Robotics"),
        ("STE", "Batteries"),
        ("EOSE", "Batteries"),
        ("ELVA", "Batteries"),
        ("FLNC", "Batteries"),
        ("QBTS", "Quantum"),
        ("IONQ", "Quantum"),
        ("RGTI", "Quantum"),
        ("QUBT", "Quantum"),
        ("GH", "Healthcare"),
        ("GRAL", "Healthcare"),
        ("MIRM", "Healthcare"),
        ("VRT", "Data centres"),
        ("ANET", "Data centres"),
        ("TMQ", "Critical minerals"),
        ("UUUU", "Critical minerals"),
    ],
    # Quantum computing — high-beta hype basket. Pure-plays are the WSB /
    # retail magnets that spike on any policy headline (e.g. National
    # Quantum Initiative reauth, CHIPS-style funding mentions). Big-tech
    # names give diversified exposure with less drawdown risk.
    "quantum": [
        # Small-cap pure-plays — most volatile, most hype-sensitive
        ("IONQ", "Pure-plays"),
        ("RGTI", "Pure-plays"),
        ("QBTS", "Pure-plays"),  # D-Wave Quantum
        ("QUBT", "Pure-plays"),  # Quantum Computing Inc
        ("ARQQ", "Pure-plays"),  # Arqit Quantum
        # Mega-cap programs — Willow (GOOGL), Majorana 1 (MSFT), Heron (IBM)
        ("IBM", "Big tech"),
        ("GOOGL", "Big tech"),
        ("MSFT", "Big tech"),
        ("AMZN", "Big tech"),  # AWS Braket
        ("INTC", "Big tech"),
        ("HON", "Big tech"),  # Quantinuum stake
        # Picks-and-shovels / adjacent
        ("NVDA", "Picks & shovels"),  # CUDA-Q hybrid stack
        ("LMT", "Picks & shovels"),  # Defense quantum apps
        ("BAH", "Picks & shovels"),  # Quantum consulting for federal
        # International — extra geopolitical risk premium
        ("BABA", "International"),  # Alibaba Quantum Lab
    ],
}

# Score threshold above which the "smart" rule reports in-zone. Same default
# the Buy Watch uses for the smart preset.
DEFAULT_THRESHOLD = 65.0


@router.get("/{theme}")
async def list_theme(theme: str) -> dict[str, Any]:
    """Evaluate a curated theme list. Returns the same row shape as
    /buy-watch but with synthetic ids and a `group` field per row so the
    UI can render section headers."""
    if theme not in THEMES:
        raise HTTPException(status_code=404, detail=f"unknown theme: {theme}")
    entries = THEMES[theme]
    # Build pseudo BuyTarget objects so we can reuse _enrich_targets.
    # The DB model needs id+symbol+rule+threshold; we fake them.
    fakes: list[models.BuyTarget] = []
    group_by_sym: dict[str, str] = {}
    for i, (sym, group) in enumerate(entries):
        fakes.append(
            models.BuyTarget(
                id=-(i + 1),  # negative ids so they can't collide with real ones
                symbol=sym,
                rule="smart",
                target_price=None,
                threshold=DEFAULT_THRESHOLD,
                note=None,
                sort_order=i,
            )
        )
        group_by_sym[sym.upper()] = group
    enriched = await bw._enrich_targets(fakes)
    # Attach the group label so the UI can render sections / sort by it.
    for row in enriched:
        row["group"] = group_by_sym.get(row["symbol"], "")
    return {
        "theme": theme,
        "ticker_count": len(entries),
        "targets": enriched,
    }
