import hmac
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel

from .config import get_settings
from .db import Base, SessionLocal, engine
from .models import WatchlistTicker
from .routers import (
    alerts,
    bot,
    buy_watch,
    calendar,
    market,
    options,
    positions,
    snaptrade,
    stock,
    theme_watch,
    watchlist,
    worldcup,
)
from .services import alerts_runner, streamer
from .services.bot import runner as bot_runner

DEFAULT_WATCHLIST = ["AAPL", "NVDA", "TSLA", "SPY", "QQQ"]


def _seed_watchlist() -> None:
    db = SessionLocal()
    try:
        if db.query(WatchlistTicker).count() == 0:
            for i, sym in enumerate(DEFAULT_WATCHLIST):
                db.add(WatchlistTicker(symbol=sym, sort_order=i))
            db.commit()
    finally:
        db.close()


_DEFAULT_PASSWORD = "changeme-please"
_DEFAULT_SECRET = "dev-secret-change-me"


def _assert_production_credentials() -> None:
    """Refuse to serve a production deploy (postgres = Render) with the
    default password/secret — anyone could log in as owner otherwise.
    Local sqlite dev keeps working without env setup."""
    s = get_settings()
    if not s.database_url.startswith("postgres"):
        return
    problems = []
    if s.app_password == _DEFAULT_PASSWORD:
        problems.append("APP_PASSWORD")
    if s.session_secret == _DEFAULT_SECRET:
        problems.append("SESSION_SECRET")
    if problems:
        raise RuntimeError(
            f"Refusing to start: {', '.join(problems)} still set to the built-in "
            "default on a production database. Set real values in the Render "
            "dashboard (Environment tab) and redeploy."
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    _assert_production_credentials()
    Base.metadata.create_all(bind=engine)
    _seed_watchlist()
    # Background bot loop. The runner itself checks BotState.running every
    # tick and no-ops while disabled, so it's cheap to leave running.
    import asyncio

    task = asyncio.create_task(bot_runner.loop())
    alerts_task = asyncio.create_task(alerts_runner.loop())
    try:
        yield
    finally:
        for t in (task, alerts_task):
            t.cancel()
        for t in (task, alerts_task):
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass


app = FastAPI(title="JnVest API", lifespan=lifespan)
settings = get_settings()
# Timed serializer: tokens expire server-side after SESSION_MAX_AGE even if
# a cookie is exfiltrated. Matches the cookie's own max_age.
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days
serializer = URLSafeTimedSerializer(settings.session_secret, salt="jnvest-session")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Auth ---

PUBLIC_PATHS = {"/api/auth/login", "/api/auth/status", "/api/health"}


class LoginPayload(BaseModel):
    password: str


def _session_role(request: Request) -> str:
    """Returns 'owner' | 'guest'. Anyone without a valid owner cookie is a guest."""
    token = request.cookies.get("jnvest_session")
    if not token:
        return "guest"
    try:
        val = serializer.loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return "guest"
    return "owner" if val == "ok" else "guest"


def is_guest(request: Request) -> bool:
    return _session_role(request) != "owner"


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Open by default — anyone can hit GETs and gets the guest view.
    Mutations (POST/PUT/DELETE) require owner login."""
    path = request.url.path
    if path.startswith("/api") and request.method not in ("GET", "HEAD", "OPTIONS"):
        is_public = path in PUBLIC_PATHS or path.startswith("/api/auth/")
        if not is_public and _session_role(request) != "owner":
            return JSONResponse(
                {"detail": "owner login required for write operations"},
                status_code=401,
            )
    return await call_next(request)


# Brute-force guard for /api/auth/login: per-IP sliding window, in-memory.
# Single-process app, so a dict is enough; restarts reset it, which is fine —
# the goal is stopping fast password-guessing loops, not nation-states.
_LOGIN_WINDOW_SECONDS = 15 * 60
_LOGIN_MAX_ATTEMPTS = 5
_login_attempts: dict[str, list[float]] = {}


def _client_ip(request: Request) -> str:
    # Render terminates TLS at a proxy; the real client is the first hop in
    # X-Forwarded-For. Fall back to the socket peer for local dev.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _login_rate_limited(ip: str) -> bool:
    now = time.monotonic()
    attempts = [t for t in _login_attempts.get(ip, []) if now - t < _LOGIN_WINDOW_SECONDS]
    _login_attempts[ip] = attempts
    if len(attempts) >= _LOGIN_MAX_ATTEMPTS:
        return True
    # Opportunistic cleanup so the dict can't grow unbounded under scanning.
    if len(_login_attempts) > 1000:
        stale = [
            k for k, v in _login_attempts.items() if not v or now - v[-1] > _LOGIN_WINDOW_SECONDS
        ]
        for k in stale:
            del _login_attempts[k]
    return False


@app.post("/api/auth/login")
async def login(payload: LoginPayload, request: Request, response: Response) -> dict:
    ip = _client_ip(request)
    if _login_rate_limited(ip):
        raise HTTPException(
            status_code=429,
            detail="too many login attempts — try again in 15 minutes",
        )
    if not hmac.compare_digest(
        payload.password.encode("utf-8"), settings.app_password.encode("utf-8")
    ):
        _login_attempts.setdefault(ip, []).append(time.monotonic())
        raise HTTPException(status_code=401, detail="invalid password")
    _login_attempts.pop(ip, None)
    token = serializer.dumps("ok")
    response.set_cookie(
        "jnvest_session",
        token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=not settings.database_url.startswith("sqlite"),
    )
    return {"ok": True, "role": "owner"}


@app.post("/api/auth/logout")
async def logout(response: Response) -> dict:
    response.delete_cookie("jnvest_session")
    return {"ok": True}


@app.get("/api/auth/status")
async def auth_status(request: Request) -> dict:
    role = _session_role(request)
    return {"authed": role == "owner", "is_paper": settings.is_paper, "role": role}


@app.get("/api/health")
async def health() -> dict:
    return {
        "ok": True,
        "is_paper": settings.is_paper,
        "alpaca_configured": bool(settings.alpaca_api_key and settings.alpaca_api_secret),
        "finnhub_configured": bool(settings.finnhub_api_key),
        "snaptrade_configured": bool(
            settings.snaptrade_client_id and settings.snaptrade_consumer_key
        ),
        "db": "postgres" if settings.database_url.startswith("postgres") else "sqlite",
    }


app.include_router(market.router, prefix="/api")
app.include_router(watchlist.router, prefix="/api")
app.include_router(stock.router, prefix="/api")
app.include_router(options.router, prefix="/api")
app.include_router(calendar.router, prefix="/api")
app.include_router(positions.router, prefix="/api")
# orders.router is intentionally not mounted: paper-trading order ticket was
# removed from the UI. Restore by re-adding `app.include_router(orders.router, prefix="/api")`.
app.include_router(snaptrade.router, prefix="/api")
app.include_router(buy_watch.router, prefix="/api")
app.include_router(theme_watch.router, prefix="/api")
app.include_router(bot.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")
app.include_router(worldcup.router, prefix="/api")


@app.websocket("/api/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    # Open WS — guests can stream too. The connection is read-only by design
    # (we don't process inbound client messages).
    await websocket.accept()
    await streamer.register_client(websocket)
    try:
        while True:
            # We don't process inbound client messages, but reading keeps the
            # connection alive and detects disconnects.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await streamer.unregister_client(websocket)


# --- Static frontend (production only) ---

FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIST / "assets"),
        name="assets",
    )

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str) -> FileResponse:
        # Don't intercept API routes
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        # If a real static file exists at this path (logo.svg, favicon.svg,
        # manifest.webmanifest, sw.js, etc.) serve it directly. Otherwise
        # fall through to the SPA index for client-side routing.
        if full_path:
            candidate = FRONTEND_DIST / full_path
            try:
                # Path-traversal safety: must resolve inside FRONTEND_DIST.
                resolved = candidate.resolve()
                if resolved.is_relative_to(FRONTEND_DIST.resolve()) and resolved.is_file():
                    return FileResponse(resolved)
            except (OSError, ValueError):
                pass
        index = FRONTEND_DIST / "index.html"
        if not index.exists():
            raise HTTPException(status_code=404)
        return FileResponse(index)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=True,
    )
