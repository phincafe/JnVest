"""SPY 0-DTE RSI-divergence bot.

Paper-only. Off by default. Hard-gated against live trading via Alpaca's
existing `submit_order` paper check + an explicit `BotState.running` flag
that must be flipped via the API.

Architecture (see individual modules):
- detector.py: pure-function RSI(14) divergence detection on 5m bars
- contract.py: 0-DTE ATM SPY OCC-symbol resolver
- sizing.py: -2%-of-account risk-based qty sizing
- runner.py: asyncio loop that ticks every 60s during market hours
- monitor.py: closes open positions at +20% / -20% / 3:30pm ET
- safety.py: paper-only gate, daily loss cap, position cap, rate limit
"""
