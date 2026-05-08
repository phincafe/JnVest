"""Single Alpaca WebSocket connection fanned out to many browser clients.

Single-process / single-user app: keep state at module scope. Background task auto-starts
on first client connect. Reconnects with exponential backoff. Resubscribes on watchlist change.
"""

import asyncio
import contextlib
import json
import logging
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

import websockets
from fastapi import WebSocket

from ..config import get_settings
from ..db import SessionLocal
from ..models import WatchlistTicker

log = logging.getLogger("jnvest.stream")

ALPACA_WS_URL = "wss://stream.data.alpaca.markets/v2/iex"


@dataclass
class _State:
    clients: set[WebSocket]
    subs: set[str]
    task: asyncio.Task | None
    resub_event: asyncio.Event


_state: _State | None = None


def _get_state() -> _State:
    global _state
    if _state is None:
        _state = _State(clients=set(), subs=set(), task=None, resub_event=asyncio.Event())
    return _state


def current_watchlist_symbols() -> list[str]:
    db = SessionLocal()
    try:
        return [
            r.symbol for r in db.query(WatchlistTicker).order_by(WatchlistTicker.sort_order).all()
        ]
    finally:
        db.close()


def notify_watchlist_changed() -> None:
    state = _get_state()
    state.resub_event.set()


async def register_client(ws: WebSocket) -> None:
    state = _get_state()
    state.clients.add(ws)
    if state.task is None or state.task.done():
        state.task = asyncio.create_task(_alpaca_loop(), name="jnvest.alpaca-stream")


async def unregister_client(ws: WebSocket) -> None:
    state = _get_state()
    state.clients.discard(ws)


async def _broadcast(message: dict[str, Any]) -> None:
    state = _get_state()
    if not state.clients:
        return
    payload = json.dumps(message)
    dead: list[WebSocket] = []
    for client in list(state.clients):
        try:
            await client.send_text(payload)
        except Exception:
            dead.append(client)
    for d in dead:
        state.clients.discard(d)


async def _alpaca_loop() -> None:
    settings = get_settings()
    if not (settings.alpaca_api_key and settings.alpaca_api_secret):
        log.warning("Alpaca credentials missing; stream will not start")
        await _broadcast({"type": "status", "status": "no_credentials"})
        return

    backoff = 2.0
    while True:
        state = _get_state()
        if not state.clients:
            log.info("No clients; stream loop exiting")
            return
        try:
            await _broadcast({"type": "status", "status": "connecting"})
            async with websockets.connect(ALPACA_WS_URL, ping_interval=20) as ws:
                await _handshake(ws)
                await _subscribe(ws, current_watchlist_symbols())
                backoff = 2.0
                await _read_loop(ws)
        except Exception as e:
            log.warning("Alpaca stream error: %s; reconnecting in %.1fs", e, backoff)
            await _broadcast({"type": "status", "status": "reconnecting", "detail": str(e)})
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60.0)


async def _handshake(ws) -> None:
    settings = get_settings()
    welcome = json.loads(await ws.recv())
    if welcome[0].get("T") != "success" or welcome[0].get("msg") != "connected":
        raise RuntimeError(f"unexpected welcome: {welcome}")
    await ws.send(
        json.dumps(
            {
                "action": "auth",
                "key": settings.alpaca_api_key,
                "secret": settings.alpaca_api_secret,
            }
        )
    )
    auth = json.loads(await ws.recv())
    if auth[0].get("T") != "success" or auth[0].get("msg") != "authenticated":
        raise RuntimeError(f"alpaca auth failed: {auth}")


async def _subscribe(ws, symbols: Iterable[str]) -> None:
    state = _get_state()
    new_subs = set(symbols)
    if not new_subs:
        state.subs = set()
        return
    add = list(new_subs - state.subs)
    drop = list(state.subs - new_subs)
    if add:
        await ws.send(json.dumps({"action": "subscribe", "trades": add, "quotes": add}))
    if drop:
        await ws.send(json.dumps({"action": "unsubscribe", "trades": drop, "quotes": drop}))
    state.subs = new_subs
    await _broadcast({"type": "status", "status": "subscribed", "symbols": sorted(new_subs)})


async def _read_loop(ws) -> None:
    state = _get_state()
    state.resub_event.clear()
    recv_task = asyncio.create_task(ws.recv())
    resub_task = asyncio.create_task(state.resub_event.wait())
    try:
        while True:
            done, _ = await asyncio.wait(
                {recv_task, resub_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            if recv_task in done:
                raw = recv_task.result()
                msgs = json.loads(raw)
                for m in msgs:
                    t = m.get("T")
                    if t == "t":  # trade
                        await _broadcast(
                            {
                                "type": "trade",
                                "symbol": m.get("S"),
                                "price": m.get("p"),
                                "size": m.get("s"),
                                "ts": m.get("t"),
                            }
                        )
                    elif t == "q":  # quote
                        await _broadcast(
                            {
                                "type": "quote",
                                "symbol": m.get("S"),
                                "bid": m.get("bp"),
                                "ask": m.get("ap"),
                                "ts": m.get("t"),
                            }
                        )
                recv_task = asyncio.create_task(ws.recv())
            if resub_task in done:
                state.resub_event.clear()
                await _subscribe(ws, current_watchlist_symbols())
                resub_task = asyncio.create_task(state.resub_event.wait())
    finally:
        for t in (recv_task, resub_task):
            t.cancel()
            with contextlib.suppress(Exception):
                await t
