import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import BadSignature, URLSafeSerializer
from pydantic import BaseModel

from .config import get_settings
from .db import Base, SessionLocal, engine
from .models import WatchlistTicker
from .routers import (
    calendar,
    market,
    options,
    plaid,
    positions,
    snaptrade,
    stock,
    watchlist,
)
from .services import streamer

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


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    _seed_watchlist()
    yield


app = FastAPI(title="JnVest API", lifespan=lifespan)
settings = get_settings()
serializer = URLSafeSerializer(settings.session_secret, salt="jnvest-session")

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
        val = serializer.loads(token)
    except BadSignature:
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


@app.post("/api/auth/login")
async def login(payload: LoginPayload, response: Response) -> dict:
    if payload.password != settings.app_password:
        raise HTTPException(status_code=401, detail="invalid password")
    token = serializer.dumps("ok")
    response.set_cookie(
        "jnvest_session",
        token,
        max_age=60 * 60 * 24 * 30,
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
        "plaid_configured": bool(settings.plaid_client_id and settings.plaid_secret),
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
app.include_router(plaid.router, prefix="/api")
app.include_router(snaptrade.router, prefix="/api")


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
