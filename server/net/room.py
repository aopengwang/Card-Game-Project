"""Rooms: lobby, seats, connections, and the async task that drives a game.

One asyncio event loop runs everything. A room's game is the engine generator;
`_drive` pulls Requests out of it and gets each answer from:
  - the seat's human (over websocket), with a timeout -> req.default(); or
  - a bot, for bot seats and for humans who are disconnected (AFK takeover).

Hidden information: each connection only ever receives view_for/log_for for
its own seat, and only the asked seat receives a request. Who is being asked
for a *response* (Dodge, Nullify, Peach...) is not broadcast, since players
with no possible card are skipped and that would leak hand contents.
"""
from __future__ import annotations

import asyncio
import json
import random
import secrets
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from bots import BOT_LEVELS, make_bot
from content.heroes import HERO_MAP
from content.standard import new_game
from engine import REFRESH, ROLE_TABLE, Game, PlayRequest, Request, Role
from engine import sandbox
from engine.view import log_for, view_for

from .protocol import ProtocolError, parse_answer, request_to_dict

MIN_PLAYERS, MAX_PLAYERS = 4, 8
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"  # no I / O
NAME_MAX = 20
PASSWORD_MAX = 40
CHAT_MAX = 200  # characters per message (longer ones are cut)
CHAT_KEEP = 100  # messages a room remembers (sent to whoever (re)connects)
CHAT_BURST = (5, 10.0)  # at most 5 messages per 10 seconds per player
JOIN_TRIES = (10, 60.0)  # at most 10 wrong passwords per minute per room
# Emotes players can send (shown beside their seat for a moment; never stored).
EMOTES = ("nice", "haha", "thanks", "sorry", "angry", "whoa", "hmm", "cheers", "gg", "hurry")
EMOTE_BURST = (4, 6.0)  # at most 4 emotes per 6 seconds per player
PRIVATE_KINDS = {"respond"}  # don't reveal who is being asked


class Socket(Protocol):
    async def send_text(self, data: str) -> None: ...


@dataclass
class Settings:
    play_timeout: float = 90.0  # your own play phase
    response_timeout: float = 20.0  # dodge / peach / nullify / confirm...
    hero_timeout: float = 60.0
    bot_delay: float = 0.6  # pause before bot answers so humans can follow along
    room_ttl: float = 3 * 3600  # idle rooms with nobody connected are removed after this
    # (the first four are each new room's starting options; the host can change them)

# Game options the host can change in the lobby, and their allowed ranges (seconds).
# The ranges are sent to clients, which build their controls from them.
OPTION_LIMITS: dict[str, tuple[float, float]] = {
    "play_timeout": (15, 300),  # your own play phase
    "response_timeout": (5, 60),  # dodge / peach / nullify / confirm...
    "hero_timeout": (15, 180),  # choosing a hero, discarding
    "bot_delay": (0, 3),  # pause before a bot acts (bot speed)
}


@dataclass
class RoomOptions:
    """One room's game options: start from the server defaults, the host can change them."""

    play_timeout: float
    response_timeout: float
    hero_timeout: float
    bot_delay: float

    @classmethod
    def from_settings(cls, s: Settings) -> RoomOptions:
        return cls(s.play_timeout, s.response_timeout, s.hero_timeout, s.bot_delay)

    def to_dict(self) -> dict[str, float]:
        return {k: getattr(self, k) for k in OPTION_LIMITS}

    def update(self, changes: Any) -> None:
        """Apply {option: seconds}; all-or-nothing, so a bad value changes nothing."""
        if not isinstance(changes, dict) or not changes:
            raise RoomError("settings must be an object of option -> seconds")
        checked: dict[str, float] = {}
        for key, value in changes.items():
            if key not in OPTION_LIMITS:
                raise RoomError(f"unknown setting {key!r}")
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise RoomError(f"{key} must be a number of seconds")
            lo, hi = OPTION_LIMITS[key]
            if not lo <= value <= hi:
                raise RoomError(f"{key} must be between {lo:g} and {hi:g} seconds")
            checked[key] = float(value)
        for key, value in checked.items():
            setattr(self, key, value)

    def timeout_for(self, req: Request) -> float:
        if req.kind == "play":
            return self.play_timeout
        if req.kind in ("choose_hero", "discard"):
            return self.hero_timeout
        return self.response_timeout


class Conn:
    """One websocket. Serializes sends and remembers how much of the log it has seen."""

    def __init__(self, ws: Socket):
        self.ws = ws
        self.lock = asyncio.Lock()
        self.log_cursor = 0
        self.alive = True

    async def send(self, msg: dict[str, Any]) -> None:
        if not self.alive:
            return
        try:
            async with self.lock:
                await self.ws.send_text(json.dumps(msg))
        except Exception:  # broken socket: the read loop will clean up
            self.alive = False


@dataclass(eq=False)
class Member:
    name: str
    token: str
    is_bot: bool = False
    bot_level: str = "hard"  # for bot seats; humans who go AFK are covered by a hard bot
    conns: set[Conn] = field(default_factory=set)
    chat_times: list[float] = field(default_factory=list)  # recent message times (rate limit)
    emote_times: list[float] = field(default_factory=list)

    @property
    def connected(self) -> bool:
        return self.is_bot or any(c.alive for c in self.conns)


@dataclass
class Pending:
    id: int
    req: Request
    seat: int
    deadline: float  # loop time
    future: asyncio.Future
    # Test room: the player answering for a bot seat (None: the seat's own player).
    by: Member | None = None

    def answerer(self, room: Room) -> Member:
        return self.by or room.members[self.seat]


_BOT = object()  # "let the bot answer" (seat went AFK while being asked)


class Room:
    def __init__(self, code: str, settings: Settings):
        self.code = code
        self.settings = settings
        self.options = RoomOptions.from_settings(settings)
        # Heroes the host has taken out of the draft (stored this way round so heroes
        # added to the game later start enabled).
        self.disabled_heroes: set[str] = set()
        self.battle = True  # play with the Battle expansion's 52 cards (the host can turn it off)
        # Test room: no draft, the table fills up with bots, and anyone can change heroes,
        # cards and HP mid-game (engine/sandbox.py). Bots sit still unless told to play.
        self.sandbox = False
        self.passive_bots = True
        # Test room: the player who plays the bots' turns and answers their requests (each
        # sent to them with the bot's own view), or None to let the bots play.
        self.controller: Member | None = None
        self._waiting: Request | None = None  # the request the game is paused on
        # Optional: new players must give it to join (reconnecting with your token never
        # needs it). Only the host is ever sent it back.
        self.password: str | None = None
        self._failed_joins: list[float] = []
        self.chat: list[dict[str, Any]] = []
        self._chat_seq = 0
        self.members: list[Member] = []
        self.host_token: str | None = None
        self.status = "lobby"  # lobby | playing | finished
        self.game: Game | None = None
        self.task: asyncio.Task | None = None
        self.pending: Pending | None = None
        self.bots: list[Any] = []  # one bot per seat: plays bot seats and covers AFK humans
        self._req_seq = 0
        self._last_req: Request | None = None
        self._last_deadline = 0.0
        self.last_activity = time.monotonic()

    # ------------------------------------------------------------ membership

    def _new_token(self) -> str:
        return secrets.token_urlsafe(18)

    def add_human(self, name: str) -> Member:
        name = " ".join(name.split())[:NAME_MAX] or "Player"
        if self.status == "playing":
            raise RoomError("the game has already started")
        if len(self.members) >= MAX_PLAYERS:
            raise RoomError("the room is full")
        m = Member(name=name, token=self._new_token())
        self.members.append(m)
        if self.host_token is None:
            self.host_token = m.token
        return m

    def add_bot(self, level: str = "hard") -> Member:
        if level not in BOT_LEVELS:
            raise RoomError(f"unknown bot level {level!r} (choose from {', '.join(BOT_LEVELS)})")
        if len(self.members) >= MAX_PLAYERS:
            raise RoomError("the room is full")
        n = sum(1 for m in self.members if m.is_bot) + 1
        m = Member(name=f"Bot {n}", token=self._new_token(), is_bot=True, bot_level=level)
        self.members.append(m)
        return m

    def remove(self, seat: int) -> Member:
        if self.status == "playing":
            raise RoomError("can't remove players during a game")
        if not 0 <= seat < len(self.members):
            raise RoomError("no such seat")
        m = self.members[seat]
        if m.token == self.host_token:
            raise RoomError("the host can't be removed")
        self.members.pop(seat)
        return m

    def set_disabled_heroes(self, disabled: Any) -> None:
        """Replace the disabled list. Any choice is allowed here, even none enabled (the host
        may clear the pool and pick a few back); start() checks there's one per player."""
        if not isinstance(disabled, list) or not all(isinstance(h, str) for h in disabled):
            raise RoomError("disabled heroes must be a list of hero ids")
        unknown = set(disabled) - set(HERO_MAP)
        if unknown:
            raise RoomError(f"unknown hero {sorted(unknown)[0]!r}")
        self.disabled_heroes = set(disabled)

    @property
    def hero_pool(self) -> list[str]:
        return sorted(set(HERO_MAP) - self.disabled_heroes)

    def set_password(self, password: Any) -> None:
        """Set (a non-empty string) or clear (None / "") the room password."""
        if password is None or password == "":
            self.password = None
            return
        if not isinstance(password, str) or not password.strip():
            raise RoomError("the password must be text")
        if len(password) > PASSWORD_MAX:
            raise RoomError(f"the password can be at most {PASSWORD_MAX} characters")
        self.password = password

    def check_password(self, given: Any) -> None:
        """Raise RoomError unless `given` opens this room (no password: anything does)."""
        if self.password is None:
            return
        now = time.monotonic()
        window = JOIN_TRIES[1]
        self._failed_joins = [t for t in self._failed_joins if now - t < window]
        if len(self._failed_joins) >= JOIN_TRIES[0]:
            raise RoomError("too many wrong passwords, try again in a minute")
        if not given:
            raise RoomError("this room needs a password")
        if not isinstance(given, str) or not secrets.compare_digest(given.encode(), self.password.encode()):
            self._failed_joins.append(now)
            raise RoomError("wrong password")

    def add_chat(self, m: Member, text: Any) -> dict[str, Any]:
        """Record a chat message from `m` (rate-limited) and return it, ready to broadcast."""
        if not isinstance(text, str):
            raise RoomError("chat messages must be text")
        text = " ".join(text.split())[:CHAT_MAX]
        if not text:
            raise RoomError("empty message")
        now = time.monotonic()
        limit, window = CHAT_BURST
        m.chat_times = [t for t in m.chat_times if now - t < window]
        if len(m.chat_times) >= limit:
            raise RoomError("you're sending messages too fast")
        m.chat_times.append(now)
        self._chat_seq += 1
        msg = {"id": self._chat_seq, "seat": self.seat_of(m), "name": m.name, "text": text, "time": int(time.time() * 1000)}
        self.chat = [*self.chat, msg][-CHAT_KEEP:]
        return msg

    def check_emote(self, m: Member, emote: Any) -> None:
        if emote not in EMOTES:
            raise RoomError("unknown emote")
        now = time.monotonic()
        limit, window = EMOTE_BURST
        m.emote_times = [t for t in m.emote_times if now - t < window]
        if len(m.emote_times) >= limit:
            raise RoomError("you're sending emotes too fast")
        m.emote_times.append(now)

    def by_token(self, token: str) -> Member | None:
        return next((m for m in self.members if secrets.compare_digest(m.token, token)), None)

    def seat_of(self, m: Member) -> int:
        return self.members.index(m)

    @property
    def has_connections(self) -> bool:
        return any(c.alive for m in self.members for c in m.conns)

    def room_info(self, viewer: Member | None) -> dict[str, Any]:
        is_host = viewer is not None and viewer.token == self.host_token
        return {
            "type": "room",
            "code": self.code,
            "status": self.status,
            "you": self.seat_of(viewer) if viewer in self.members else None,
            "host": next((i for i, m in enumerate(self.members) if m.token == self.host_token), None),
            "members": [
                {"name": m.name, "bot": m.is_bot, "level": m.bot_level if m.is_bot else None, "connected": m.connected}
                for m in self.members
            ],
            "bot_levels": list(BOT_LEVELS),
            "min_players": MIN_PLAYERS,
            "max_players": MAX_PLAYERS,
            "options": self.options.to_dict(),
            "option_limits": {k: list(v) for k, v in OPTION_LIMITS.items()},
            "disabled_heroes": sorted(self.disabled_heroes),
            "battle": self.battle,
            "sandbox": self.sandbox,
            "passive_bots": self.passive_bots,
            "control_bots": self.controller is not None,
            "you_control": viewer is not None and self.controller is viewer,
            "locked": self.password is not None,
            **({"password": self.password} if is_host and self.password is not None else {}),
        }

    # ------------------------------------------------------------ connections

    async def connect(self, m: Member, ws: Socket) -> Conn:
        conn = Conn(ws)
        m.conns.add(conn)
        self.last_activity = time.monotonic()
        await self.broadcast_room()
        await conn.send({"type": "chat_history", "messages": self.chat})
        if self.game is not None:
            await self._push(m, conn)
            p = self.pending
            if p is not None and p.answerer(self) is m:
                await self._send_request(conn, p)
        return conn

    async def disconnect(self, m: Member, conn: Conn) -> None:
        conn.alive = False
        m.conns.discard(conn)
        self.last_activity = time.monotonic()
        p = self.pending
        if p is not None and p.answerer(self) is m and not m.connected and not p.future.done():
            p.future.set_result(_BOT)  # AFK: a bot answers for them
        await self.broadcast_room()

    async def broadcast_room(self) -> None:
        for m in self.members:
            info = self.room_info(m)
            for c in list(m.conns):
                await c.send(info)

    # ------------------------------------------------------------ incoming

    async def handle(self, m: Member, conn: Conn, msg: Any) -> None:
        self.last_activity = time.monotonic()
        if not isinstance(msg, dict):
            raise RoomError("messages must be JSON objects")
        t = msg.get("type")
        host = m.token == self.host_token
        if t == "answer":
            await self._on_answer(m, conn, msg)
        elif t == "add_bot":
            self._need(host and self.status != "playing", "only the host can add bots before the game")
            level = msg.get("level", "hard")
            self.add_bot(level if isinstance(level, str) else "")
            await self.broadcast_room()
        elif t == "remove":
            self._need(host, "only the host can remove players")
            removed = self.remove(msg.get("seat", -1) if isinstance(msg.get("seat"), int) else -1)
            for c in list(removed.conns):
                await c.send({"type": "kicked"})
            await self.broadcast_room()
        elif t == "settings":
            self._need(host, "only the host can change the game settings")
            self._need(self.status != "playing", "settings can't change during a game")
            self.options.update(msg.get("settings"))
            await self.broadcast_room()
        elif t == "heroes":
            self._need(host, "only the host can choose the heroes")
            self._need(self.status != "playing", "settings can't change during a game")
            self.set_disabled_heroes(msg.get("disabled"))
            await self.broadcast_room()
        elif t == "chat":
            msg = self.add_chat(m, msg.get("text"))
            for member in self.members:
                for c in list(member.conns):
                    await c.send({"type": "chat", **msg})
        elif t == "emote":
            emote = msg.get("emote")
            self.check_emote(m, emote)
            for member in self.members:
                for c in list(member.conns):
                    await c.send({"type": "emote", "seat": self.seat_of(m), "emote": emote})
        elif t == "password":
            self._need(host, "only the host can set the password")
            self.set_password(msg.get("password"))
            await self.broadcast_room()
        elif t == "deck":
            self._need(host, "only the host can choose the deck")
            self._need(self.status != "playing", "settings can't change during a game")
            battle = msg.get("battle")
            self._need(isinstance(battle, bool), "battle must be true or false")
            self.battle = battle
            await self.broadcast_room()
        elif t == "sandbox":
            self._need(host, "only the host can make this a test room")
            self._need(self.status != "playing", "settings can't change during a game")
            on = msg.get("on")
            self._need(isinstance(on, bool), "on must be true or false")
            self.sandbox = on
            await self.broadcast_room()
        elif t == "test":
            await self._on_test(m, msg)
        elif t == "start":
            self._need(host, "only the host can start the game")
            await self.start()
        elif t == "ping":
            await conn.send({"type": "pong"})
        else:
            raise RoomError(f"unknown message type {t!r}")

    @staticmethod
    def _need(ok: bool, error: str) -> None:
        if not ok:
            raise RoomError(error)

    async def _on_answer(self, m: Member, conn: Conn, msg: dict[str, Any]) -> None:
        p = self.pending
        if p is None or msg.get("id") != p.id or p.answerer(self) is not m:
            await conn.send({"type": "error", "message": "that request is no longer active"})
            return
        try:
            answer = parse_answer(p.req, msg.get("answer"))
        except ProtocolError as e:
            await conn.send({"type": "error", "message": str(e)})
            return
        if not p.future.done():
            p.future.set_result(answer)

    async def _on_test(self, m: Member, msg: dict[str, Any]) -> None:
        """A test-room action (any player may use them: it's a practice table)."""
        self._need(self.sandbox, "this isn't a test room")
        if msg.get("action") == "bots":
            passive = msg.get("passive")
            self._need(isinstance(passive, bool), "passive must be true or false")
            self.passive_bots = passive
            await self.broadcast_room()
            return
        if msg.get("action") == "control":  # play the bots' turns yourself
            on = msg.get("on")
            self._need(isinstance(on, bool), "on must be true or false")
            self._need(not m.is_bot, "only a player can control the bots")
            self.controller = m if on else (None if self.controller is m else self.controller)
            p = self.pending
            if p is not None and not p.future.done() and self.members[p.seat].is_bot and p.by is not self.controller:
                p.future.set_result(_BOT)  # the bot's current question goes to its new answerer
            await self.broadcast_room()
            return
        game = self.game
        self._need(game is not None and self.status == "playing", "start the game first")
        assert game is not None
        try:
            sandbox.apply(game, msg)
        except ValueError as e:
            raise RoomError(str(e)) from None
        p = self.pending
        if p is not None and isinstance(p.req, PlayRequest) and not p.future.done():
            p.future.set_result(REFRESH)  # their options changed: ask again (pushes the new state)
        else:
            await self.push_all(waiting=self._waiting)

    # ------------------------------------------------------------ game

    async def start(self, seed: int | None = None) -> None:
        if self.status == "playing":
            raise RoomError("the game is already running")
        if self.sandbox:  # fill the table with bots
            while len(self.members) < MIN_PLAYERS:
                self.add_bot("hard")
        if not MIN_PLAYERS <= len(self.members) <= MAX_PLAYERS:
            raise RoomError(f"need {MIN_PLAYERS}-{MAX_PLAYERS} players")
        n = len(self.members)
        pool = self.hero_pool
        if len(pool) < n:
            raise RoomError(f"enable at least {n} heroes for {n} players")
        seed = secrets.randbits(32) if seed is None else seed
        if self.sandbox:
            # No draft: random heroes (change them at the table), and the host is the Lord,
            # so they take the first turn.
            rng = random.Random(seed)
            host = next((i for i, m in enumerate(self.members) if m.token == self.host_token), 0)
            roles = list(ROLE_TABLE[n])
            rng.shuffle(roles)
            roles.remove(Role.LORD)
            roles.insert(host, Role.LORD)
            self.game = new_game(n, seed, roles, heroes=rng.sample(pool, n), battle=self.battle)
        else:
            # (no pool when every hero is enabled: the draft deals exactly as it always has)
            self.game = new_game(n, seed, draft=True, hero_pool=pool if self.disabled_heroes else None, battle=self.battle)
        self.bots = [make_bot(m.bot_level, seed + i) for i, m in enumerate(self.members)]
        for m in self.members:
            for c in m.conns:
                c.log_cursor = 0
        self.status = "playing"
        await self.broadcast_room()
        self.task = asyncio.create_task(self._drive())

    async def _drive(self) -> None:
        game = self.game
        assert game is not None
        gen = game.run()
        reply: Any = None
        try:
            while True:
                try:
                    req = gen.send(reply)
                except StopIteration:
                    break
                self._waiting = req
                await self.push_all(waiting=req)
                reply = await self._answer(req)
        finally:
            self.pending = None
            self._waiting = None
            self.status = "finished"
            await self.push_all()
            await self.broadcast_room()

    async def _answer(self, req: Request) -> Any:
        game = self.game
        assert game is not None
        m = self.members[req.seat]
        bot = self.bots[req.seat]
        # Test room: a player may be answering for the bots (see "control").
        by = self.controller if self.sandbox and m.is_bot and self.controller is not None else None
        if by is not None and not by.connected:
            by = None

        def bot_answer() -> Any:
            if self.sandbox and self.passive_bots and m.is_bot:
                return req.default()  # test room: bots end their turns and never respond
            return bot(game, req)

        if by is None and (not m.connected or m.is_bot):
            await asyncio.sleep(self.options.bot_delay)  # always yield: never starve other rooms
            return bot_answer()
        answerer = by or m
        loop = asyncio.get_running_loop()
        # The engine re-asks the same Request object after an invalid answer: keep its deadline.
        if req is not self._last_req:
            self._last_req = req
            self._last_deadline = loop.time() + self.options.timeout_for(req)
        deadline = self._last_deadline
        self._req_seq += 1
        p = Pending(self._req_seq, req, req.seat, deadline, loop.create_future(), by=by)
        self.pending = p
        for c in list(answerer.conns):
            await self._send_request(c, p)
        try:
            await asyncio.wait({p.future}, timeout=max(0.0, deadline - loop.time()))
        finally:
            self.pending = None
        if not p.future.done():
            p.future.cancel()
            for c in list(answerer.conns):
                await c.send({"type": "timeout", "id": p.id})
            return req.default()
        result = p.future.result()
        return bot_answer() if result is _BOT else result

    async def _send_request(self, conn: Conn, p: Pending) -> None:
        remaining = max(0.0, p.deadline - asyncio.get_running_loop().time())
        msg: dict[str, Any] = {"type": "request", "id": p.id, "request": request_to_dict(p.req), "timeout": remaining}
        if p.by is not None and self.game is not None:
            # Answering for a bot: what that bot sees (its hand), to choose from.
            msg["as_view"] = view_for(self.game, p.seat)
        await conn.send(msg)

    # ------------------------------------------------------------ outgoing state

    async def _push(self, m: Member, conn: Conn, waiting: dict[str, Any] | None = None) -> None:
        game = self.game
        assert game is not None
        seat = self.seat_of(m)
        await conn.send({"type": "state", "view": view_for(game, seat), "waiting": waiting})
        entries = log_for(game, seat, conn.log_cursor)
        if entries:
            await conn.send({"type": "log", "start": conn.log_cursor, "entries": entries})
            conn.log_cursor += len(entries)

    async def push_all(self, waiting: Request | None = None) -> None:
        if self.game is None:
            return
        w = None
        if waiting is not None:
            public = waiting.kind not in PRIVATE_KINDS
            w = {"seat": waiting.seat if public else None, "kind": waiting.kind if public else "response"}
        for m in self.members:
            for c in list(m.conns):
                await self._push(m, c, w)

    async def close(self) -> None:
        if self.task is not None and not self.task.done():
            self.task.cancel()


class RoomError(Exception):
    pass


class RoomManager:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or Settings()
        self.rooms: dict[str, Room] = {}

    def _new_code(self) -> str:
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))
            if code not in self.rooms:
                return code

    async def create(self) -> Room:
        await self.cleanup()
        room = Room(self._new_code(), self.settings)
        self.rooms[room.code] = room
        return room

    def get(self, code: str) -> Room | None:
        return self.rooms.get(code.upper())

    async def cleanup(self) -> None:
        now = time.monotonic()
        for code, room in list(self.rooms.items()):
            if not room.has_connections and now - room.last_activity > self.settings.room_ttl:
                await room.close()
                del self.rooms[code]
