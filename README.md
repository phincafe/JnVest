# JnVest — Daily Trading Dashboard

A single-page dashboard for stock + options trading prep, built for personal use.

> **Not investment advice.** This is a personal informational tool. Verify everything against your broker before trading.

## Features

- **Market context** — live tiles for SPY/QQQ/DIA/IWM, mini-spark tiles for VIXY (vol proxy) and UUP (USD proxy), and a heatmap of the 11 SPDR sector ETFs.
- **Watchlist** — add/remove tickers (persisted), each row shows last/change/relative-volume/distance from 20/50/200 SMA/RSI(14)/52-week range/earnings-in-N-days. Live-updating via Alpaca's WebSocket with automatic reconnect; falls back to 60s polling.
- **Stock detail** — candlestick chart (lightweight-charts) with 1D/5D/1M/6M/1Y toggle and SMA overlays, recent Finnhub news (links open in new tab), fundamentals panel.
- **Options** — IV rank + percentile (computed from accumulated daily snapshots), term structure across expirations, full skew at the front month, chain table with calls/puts/both toggle, computed greeks (Black-Scholes), unusual-volume highlight, bid-ask spread %.
- **Calendar** — today's US economic releases (impact-coded) + earnings within 7 days for any watchlist ticker.
- **Positions** — Alpaca account summary + open positions + recent orders, plus a manual positions table with live P&L for stocks held off-platform.
- **Order ticket** — paper-only in v1, with a "Preview → Confirm" modal showing exact details before submission. UI is hard-disabled when `ALPACA_BASE_URL` is not paper.

## Stack

- **Backend:** FastAPI (Python 3.11+), SQLAlchemy, Pydantic, async httpx, websockets
- **Frontend:** React 19 + Vite + TypeScript, TailwindCSS v4, Recharts, lightweight-charts, lucide-react
- **Data:** Alpaca (stocks + paper trading + WebSocket streaming), `yfinance` (options chains, earnings, fundamentals), Finnhub (news + econ calendar), FRED (optional macro)
- **DB:** SQLite locally, PostgreSQL on Render
- **Hosting:** Render — one web service builds the frontend and serves it as static files alongside the API; free Postgres add-on.

### Why FastAPI over Node?

- `yfinance` is materially better than `yahoo-finance2` for options chains and greeks.
- `alpaca-py` is the first-party SDK; the Node SDK lags.
- Pandas/numpy make the indicator + IV math trivial and unit-testable.

## Quick start (local dev)

```bash
git clone https://github.com/phincafe/JnVest.git
cd JnVest
cp .env.example .env   # then edit — see below

# Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/uvicorn app.main:app --reload --port 8000

# Frontend (in a second terminal)
cd frontend
npm install
npm run dev    # http://localhost:5173 — proxies /api to :8000
```

Open `http://localhost:5173` and log in with your `APP_PASSWORD`.

## Environment variables

See [`.env.example`](.env.example) for the full list.

| Var | Required | Purpose |
| --- | --- | --- |
| `APP_PASSWORD` | yes | Single-user login password |
| `SESSION_SECRET` | yes | Used to sign the session cookie — make it long and random (Render auto-generates) |
| `DATABASE_URL` | no | Postgres URL on Render; falls back to SQLite locally |
| `ALPACA_API_KEY` / `ALPACA_API_SECRET` | yes | Get from https://alpaca.markets — use **paper** keys |
| `ALPACA_BASE_URL` | no | `https://paper-api.alpaca.markets` (default) |
| `ALPACA_DATA_URL` | no | `https://data.alpaca.markets` (default) |
| `FINNHUB_API_KEY` | recommended | News + economic calendar (free at https://finnhub.io) |
| `FRED_API_KEY` | no | Optional, for FRED macro series |

## Data caveats

- **Alpaca free tier uses the IEX feed** (~2–3% of US equity volume). Fine for liquid names; thin tickers may show stale prints. SIP feed is paid.
- **Yahoo Finance** (via `yfinance`) is delayed ~15 min and unofficial. We use it only for options chains, IV history, earnings dates, and fundamentals.
- **Greeks are computed by JnVest using Black-Scholes-Merton** with a 5% default risk-free rate and zero dividend yield. They will not match your broker exactly.
- **IV rank/percentile** require 30+ daily snapshots — JnVest collects these organically as you load each ticker. Until then, the cards show "Nd / 30 needed".
- Free API tiers have strict rate limits — heavy use will require paid data (Polygon, Tradier, Alpaca SIP).

## Trading mode

**Default deployment uses Alpaca paper trading.** A "PAPER" badge is visible in the UI at all times. To switch to live trading you must:

1. Change `ALPACA_BASE_URL` to the live URL.
2. Be aware: the order ticket UI is currently **gated to paper only** in v1. With a live URL, the order ticket panel disables itself and the backend rejects `/api/orders` POSTs with 403.

## Deploying to Render

1. Push this repo to GitHub (this repo: [phincafe/JnVest](https://github.com/phincafe/JnVest)).
2. In Render, click **New → Blueprint** and point it at the repo.
3. Render reads [`render.yaml`](render.yaml) and provisions one web service running `uvicorn` (Python 3.11.10) that serves the built frontend. **Note:** Render's free tier allows only one Postgres database per account, so the blueprint does NOT provision one. You bring your own:
   - **Reuse an existing Render Postgres** — copy its Internal Database URL.
   - **Free elsewhere** — [Neon](https://neon.tech), [Supabase](https://supabase.com), or similar.
   - **Skip Postgres** — leave `DATABASE_URL` blank to use SQLite (data resets on every redeploy unless you attach a paid disk).
4. The first deploy runs:
   ```
   pip install -e .          (in backend/)
   npm ci && npm run build   (in frontend/)
   uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```
5. Fill in the secrets in the Render dashboard (Service → Environment):
   - `DATABASE_URL` (your Postgres connection string — see step 3)
   - `APP_PASSWORD` (you choose)
   - `ALPACA_API_KEY`, `ALPACA_API_SECRET` (paper keys from https://alpaca.markets)
   - `FINNHUB_API_KEY` (free at https://finnhub.io)
   - `FRED_API_KEY` (optional)

   `SESSION_SECRET` is auto-generated by Render.

6. Re-deploy. Visit your service URL, log in with `APP_PASSWORD`.

## Tests

```bash
# Backend (pytest)
cd backend && .venv/bin/pytest -q

# Frontend (vitest)
cd frontend && npm test

# Lint
cd backend && .venv/bin/ruff check . && .venv/bin/black --check .
cd frontend && npx tsc --noEmit
```

GitHub Actions runs all of the above on every push and PR — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Repo layout

```
backend/
  app/
    main.py             FastAPI app, auth middleware, lifespan, SPA fallback
    config.py           pydantic-settings env vars
    db.py, models.py    SQLAlchemy
    routers/            market, watchlist, stock, options, calendar, positions, orders
    services/           alpaca, yahoo, finnhub, blackscholes, indicators, streamer, cache
  tests/                pytest unit tests for indicators + greeks
  pyproject.toml
frontend/
  src/
    App.tsx             auth gate + section composition
    api/                typed fetch client + types
    components/         MarketContext, Watchlist, StockDetail, OptionsPanel, Calendar, Positions, OrderTicket
    hooks/              useLiveQuotes (WebSocket)
    lib/                formatters
.github/workflows/ci.yml
render.yaml             Render Blueprint
.env.example
```
