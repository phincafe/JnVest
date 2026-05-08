# JnVest — Daily Trading Dashboard

A single-page dashboard for stock + options trading prep, built for personal use.

> **Not investment advice.** This is a personal informational tool. Verify everything against your broker before trading.

## Stack

- **Backend:** FastAPI (Python 3.11+), SQLAlchemy, Pydantic
- **Frontend:** React + Vite + TypeScript, TailwindCSS, Recharts, lightweight-charts
- **Data:** Alpaca (stocks + paper trading), `yfinance` (options chains, earnings), Finnhub (news + econ calendar), FRED (optional macro)
- **DB:** SQLite locally, PostgreSQL on Render
- **Hosting:** Render (one web service serving the built frontend + a free Postgres add-on)

## Quick start (local dev)

```bash
# 1. Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp ../.env.example ../.env  # edit values, especially APP_PASSWORD and Alpaca keys
.venv/bin/uvicorn app.main:app --reload --port 8000

# 2. Frontend (in a second terminal)
cd frontend
npm install
npm run dev   # http://localhost:5173, proxies /api to :8000
```

Default login password is whatever you set as `APP_PASSWORD`.

## Environment variables

See [`.env.example`](.env.example) for the full list. The important ones:

| Var | Purpose |
| --- | --- |
| `APP_PASSWORD` | Single-user login password |
| `SESSION_SECRET` | Used to sign the session cookie — make it long and random |
| `DATABASE_URL` | Postgres URL on Render; falls back to SQLite locally |
| `ALPACA_API_KEY` / `ALPACA_API_SECRET` | Get from https://alpaca.markets — use **paper** keys |
| `ALPACA_BASE_URL` | `https://paper-api.alpaca.markets` (default) — switching to live requires explicit change |
| `FINNHUB_API_KEY` | News + economic calendar |
| `FRED_API_KEY` | Optional, for FRED macro series |

## Data caveats

- **Alpaca free tier uses the IEX feed** (~2–3% of US equity volume). Fine for liquid names; thin tickers may show stale prints. SIP feed is paid.
- **Yahoo Finance** (via `yfinance`) is delayed ~15 min and unofficial. We use it only for options chains, greeks, IV history, and earnings dates.
- Greeks shown by `yfinance` are computed by Yahoo and may differ from your broker's values.
- Free API tiers have strict rate limits — heavy use will require paid data (Polygon, Tradier, Alpaca SIP).

## Trading mode

**Default deployment uses Alpaca paper trading.** A "PAPER" badge is visible in the UI at all times. To switch to live trading you must:

1. Change `ALPACA_BASE_URL` to the live URL.
2. Confirm in the UI dialog (when the live order ticket ships in a future version).

Live order placement is disabled in v1.

## Deploying to Render

1. Push this repo to GitHub (already done if you used the bundled git history).
2. In Render, click **New → Blueprint** and point at this repo.
3. Render reads [`render.yaml`](render.yaml) and provisions:
   - One web service running `uvicorn` and serving the built frontend.
   - One free PostgreSQL database, with `DATABASE_URL` wired automatically.
4. Fill in the secrets (`APP_PASSWORD`, `SESSION_SECRET`, Alpaca, Finnhub, FRED) in the Render dashboard.
5. First deploy runs `npm run build` for the frontend and `pip install` for the backend.

## Repo layout

```
backend/   FastAPI app, services, routers, tests
frontend/  Vite + React + TS + Tailwind
shared/    Hand-written TypeScript mirrors of Pydantic types
```

## Tests

```bash
cd backend && .venv/bin/pytest      # unit tests for indicators
cd frontend && npm test             # vitest suite (added with frontend features)
```
