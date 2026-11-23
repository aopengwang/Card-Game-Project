"""HTTP + WebSocket entry point.

    uvicorn net.app:app --host 0.0.0.0 --port 8000

Flow: POST /api/rooms (host) or POST /api/rooms/{code}/join -> {code, token}.
The client stores the token and opens WS /ws/{code}?token=...; reconnecting
with the same token takes the seat back (a bot plays for you meanwhile).

Env vars: SGS_PLAY_TIMEOUT, SGS_RESPONSE_TIMEOUT, SGS_BOT_DELAY (seconds).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from content.i18n import LANGS
from content.names import content_info
from content.standard import STANDARD

from .room import RoomError, RoomManager, Settings

STATIC = Path(__file__).parent / "static"
CLIENT_DIST = Path(__file__).resolve().parents[2] / "client" / "dist"


def settings_from_env() -> Settings:
    s = Settings()
    for attr, env in [
        ("play_timeout", "SGS_PLAY_TIMEOUT"),
        ("response_timeout", "SGS_RESPONSE_TIMEOUT"),
        ("bot_delay", "SGS_BOT_DELAY"),
    ]:
        if os.environ.get(env):
            setattr(s, attr, float(os.environ[env]))
    return s


class NameBody(BaseModel):
    name: str = ""


def create_app(settings: Settings | None = None, client_dist: Path = CLIENT_DIST) -> FastAPI:
    app = FastAPI(title="Cardgame server")
    manager = RoomManager(settings or settings_from_env())
    app.state.rooms = manager
    content = {lang: content_info(STANDARD, lang) for lang in LANGS}

    @app.get("/debug")
    async def debug_client() -> FileResponse:
        return FileResponse(STATIC / "index.html")

    @app.get("/api/content")
    async def get_content(lang: str = "en") -> dict:
        return content.get(lang, content["en"])

    @app.post("/api/rooms")
    async def create_room(body: NameBody) -> dict:
        room = await manager.create()
        m = room.add_human(body.name)
        return {"code": room.code, "token": m.token, "seat": room.seat_of(m)}

    @app.post("/api/rooms/{code}/join")
    async def join_room(code: str, body: NameBody) -> dict:
        room = manager.get(code)
        if room is None:
            raise HTTPException(404, "no such room")
        try:
            m = room.add_human(body.name)
        except RoomError as e:
            raise HTTPException(409, str(e))
        await room.broadcast_room()
        return {"code": room.code, "token": m.token, "seat": room.seat_of(m)}

    @app.get("/api/rooms/{code}")
    async def room_info(code: str) -> dict:
        room = manager.get(code)
        if room is None:
            raise HTTPException(404, "no such room")
        return room.room_info(None)

    @app.websocket("/ws/{code}")
    async def ws_endpoint(ws: WebSocket, code: str, token: str = "") -> None:
        await ws.accept()
        room = manager.get(code)
        member = room.by_token(token) if room is not None and token else None
        if room is None or member is None:
            await ws.send_text(json.dumps({"type": "error", "message": "unknown room or token", "fatal": True}))
            await ws.close(code=4404)
            return
        conn = await room.connect(member, ws)
        try:
            while True:
                text = await ws.receive_text()
                try:
                    msg = json.loads(text)
                    if member not in room.members:  # kicked
                        break
                    await room.handle(member, conn, msg)
                except (json.JSONDecodeError, RoomError) as e:
                    await conn.send({"type": "error", "message": str(e) or "bad message"})
        except WebSocketDisconnect:
            pass
        finally:
            await room.disconnect(member, conn)

    # The real client (client/dist from `npm run build`) at "/"; without a build, the
    # plain test client stands in. Mounted last so /api and /ws routes win.
    if (client_dist / "index.html").exists():
        app.mount("/", StaticFiles(directory=client_dist, html=True), name="client")
    else:

        @app.get("/")
        async def index() -> FileResponse:
            return FileResponse(STATIC / "index.html")

    return app


app = create_app()
