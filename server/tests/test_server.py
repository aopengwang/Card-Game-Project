import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from bots import SimpleBot
from engine import HAND, Convert, Play, PlayOption, PlayRequest, RespondRequest
from net.app import create_app
from net.protocol import ProtocolError, parse_answer, request_to_dict
from net.room import RoomError, RoomManager, Settings

FAST = dict(bot_delay=0.0, play_timeout=5, response_timeout=5, hero_timeout=5)


def json_default(r: dict):
    """The JSON a lazy-but-legal client would send for request dict `r`."""
    match r["kind"]:
        case "choose_hero" | "choose_player":
            return r["options"][0]
        case "choose_option":
            return r["choices"][0]
        case "discard":
            return r["options"][-r["count"]:]
        case "choose_card":
            if r["optional"]:
                return None
            return HAND if r["hidden_count"] else r["options"][0]
        case "confirm":
            return False
        case _:
            return None  # play: end phase; respond: pass


def to_json(a):
    if isinstance(a, Play):
        return {"card_id": a.card_id, "targets": list(a.targets), "skill": a.skill, "cards": list(a.cards)}
    if isinstance(a, Convert):
        return {"skill": a.skill, "cards": list(a.cards)}
    return list(a) if isinstance(a, tuple) else a


def bot_answers(room, seed=0):
    """A client that plays like SimpleBot, but entirely through the JSON protocol
    (idle clients never attack, so their games would never end)."""
    bot = SimpleBot(seed)
    return lambda r: to_json(bot(room.game, room.pending.req))


class FakeClient:
    """Stands in for a websocket. Auto-answers requests unless told otherwise."""

    def __init__(self, room, member, answer=json_default, auto=True):
        self.room, self.member, self.answer, self.auto = room, member, answer, auto
        self.msgs = []
        self.conn = None

    async def send_text(self, data: str) -> None:
        msg = json.loads(data)
        self.msgs.append(msg)
        if msg["type"] == "request" and self.auto:
            ans = self.answer(msg["request"])
            asyncio.get_running_loop().call_soon(
                lambda: asyncio.ensure_future(
                    self.room.handle(self.member, self.conn, {"type": "answer", "id": msg["id"], "answer": ans})
                )
            )

    async def connect(self):
        self.conn = await self.room.connect(self.member, self)
        return self

    def of(self, type_):
        return [m for m in self.msgs if m["type"] == type_]


async def room_with(n_humans, n_bots, **settings):
    mgr = RoomManager(Settings(**{**FAST, **settings}))
    room = await mgr.create()
    humans = [room.add_human(f"P{i}") for i in range(n_humans)]
    for _ in range(n_bots):
        room.add_bot()
    return room, humans


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, timeout=60))


# ---------------------------------------------------------------- protocol


def test_request_to_dict_flattens_options():
    req = PlayRequest(seat=1, options={7: PlayOption(7, 1, (2, 3))})
    d = request_to_dict(req)
    assert d["kind"] == "play" and d["seat"] == 1
    assert d["options"] == [{"card_id": 7, "target_count": 1, "candidates": [2, 3], "min_targets": None}]
    json.dumps(d)


def test_parse_answer_types_and_errors():
    play = PlayRequest(seat=0, options={})
    assert parse_answer(play, None) is None
    assert parse_answer(play, {"card_id": 3, "targets": [1]}) == Play(3, (1,))
    assert parse_answer(play, {"skill": "allure", "cards": [4], "targets": [2]}) == Play(None, (2,), "allure", (4,))
    resp = RespondRequest(seat=0, card_name="dodge", reason="strike", options=[1])
    assert parse_answer(resp, 1) == 1
    assert parse_answer(resp, {"skill": "serpent_spear", "cards": [1, 2]}) == Convert("serpent_spear", (1, 2))
    for bad in [{"card_id": [1]}, {"card_id": True}, "x", {"targets": "1"}]:
        with pytest.raises(ProtocolError):
            parse_answer(play, bad)


# ---------------------------------------------------------------- lobby


def test_lobby_rules():
    async def main():
        room, (host, guest) = await room_with(2, 0)
        assert room.host_token == host.token
        with pytest.raises(RoomError, match="4-8"):
            await room.start()
        for _ in range(6):
            room.add_bot()
        with pytest.raises(RoomError, match="full"):
            room.add_human("late")
        with pytest.raises(RoomError, match="host"):
            room.remove(0)
        room.remove(7)
        g = FakeClient(room, guest)
        await g.connect()
        with pytest.raises(RoomError, match="only the host"):
            await room.handle(guest, g.conn, {"type": "start"})
        assert g.of("room")[-1]["members"][1] == {"name": "P1", "bot": False, "connected": True}

    run(main())


def test_room_codes_and_tokens():
    async def main():
        mgr = RoomManager(Settings(**FAST))
        codes = {(await mgr.create()).code for _ in range(50)}
        assert len(codes) == 50 and all(len(c) == 5 and c.isupper() for c in codes)
        room = mgr.get(next(iter(codes)).lower())
        assert room is not None
        m = room.add_human("  Long   name that is way too long for the table  ")
        assert m.name == "Long name that is wa"  # whitespace collapsed, cut to 20
        assert room.by_token("nope") is None and room.by_token(m.token) is m

    run(main())


# ---------------------------------------------------------------- games


def test_all_bot_seats_play_to_the_end():
    async def main():
        room, _ = await room_with(1, 4)  # the human never connects -> a bot plays for them
        await room.start(seed=5)
        await room.task
        assert room.status == "finished" and room.game.result is not None

    run(main())


def test_humans_play_a_full_game_over_the_protocol():
    async def main():
        room, humans = await room_with(4, 1)
        clients = [await FakeClient(room, m, bot_answers(room, i)).connect() for i, m in enumerate(humans)]
        await room.start(seed=11)
        await room.task
        assert room.game.result is not None
        for seat, c in enumerate(clients):
            reqs = c.of("request")
            assert reqs and all(r["request"]["seat"] == seat for r in reqs)  # only your own requests
            for s in c.of("state"):
                v = s["view"]
                assert v["you"] == seat
                assert all("hand" not in p for p in v["players"])  # only your own hand is sent
                if s["waiting"] and s["waiting"]["kind"] == "response":
                    assert s["waiting"]["seat"] is None  # who is asked to respond stays private
            entries = [e for m in c.of("log") for e in m["entries"]]
            assert entries == [*_log_for(room, seat)]  # incremental log adds up exactly
            assert c.of("state")[-1]["view"]["result"] is not None

    run(main())


def _log_for(room, seat):
    from engine.view import log_for

    return log_for(room.game, seat)


def test_timeouts_fall_back_to_defaults():
    async def main():
        room, humans = await room_with(1, 3, play_timeout=0.01, response_timeout=0.01, hero_timeout=0.01)
        idle = await FakeClient(room, humans[0], auto=False).connect()
        await room.start(seed=3)
        while len(idle.of("timeout")) < 5 and not room.task.done():
            await asyncio.sleep(0.01)
        turns = room.game.turn_number
        await room.close()
        assert len(idle.of("timeout")) >= 5 and turns >= 2  # the game kept moving without them
        timed_out = {m["id"] for m in idle.of("timeout")}
        assert timed_out <= {m["id"] for m in idle.of("request")}

    run(main())


def test_invalid_answer_is_reasked_with_error_then_accepted():
    async def main():
        room, humans = await room_with(4, 0)
        tried = set()
        play = bot_answers(room)

        def answer(r):
            if r["kind"] == "choose_hero" and r["seat"] not in tried:
                tried.add(r["seat"])
                return "not_a_hero"
            if r["kind"] == "choose_hero":
                return r["options"][0]
            return play(r)

        clients = [await FakeClient(room, m, answer).connect() for m in humans]
        await room.start(seed=2)
        await room.task
        lord = room.game.lord_seat
        reqs = [r["request"] for r in clients[lord].of("request") if r["request"]["kind"] == "choose_hero"]
        assert reqs[0]["error"] is None and "offered heroes" in reqs[1]["error"]
        assert room.game.players[lord].hero == reqs[1]["options"][0]

    run(main())


def test_protocol_garbage_gets_an_error_not_a_crash():
    async def main():
        room, humans = await room_with(1, 3)
        c = await FakeClient(room, humans[0], auto=False).connect()
        await room.start(seed=1)
        while not c.of("request"):
            await asyncio.sleep(0.01)
        rid = c.of("request")[0]["id"]
        await room.handle(humans[0], c.conn, {"type": "answer", "id": rid, "answer": {"card_id": [1, 2]}})
        await room.handle(humans[0], c.conn, {"type": "answer", "id": rid + 99, "answer": None})
        errors = [m["message"] for m in c.of("error")]
        assert any("integer" in e or "string" in e for e in errors) and any("no longer active" in e for e in errors)
        c.auto = True
        await room.handle(humans[0], c.conn, {"type": "answer", "id": rid, "answer": json_default(c.of("request")[0]["request"])})
        await room.task

    run(main())


def test_disconnect_hands_seat_to_bot_and_reconnect_resumes():
    async def main():
        room, humans = await room_with(1, 3)
        c = await FakeClient(room, humans[0], auto=False).connect()
        await room.start(seed=9)
        while not c.of("request"):
            await asyncio.sleep(0.01)
        await room.disconnect(humans[0], c.conn)  # AFK mid-request: the bot answers
        await room.task
        assert room.game.result is not None
        back = await FakeClient(room, humans[0]).connect()
        state = back.of("state")[-1]["view"]
        assert state["result"] is not None
        logs = back.of("log")
        assert logs[0]["start"] == 0 and len(logs[0]["entries"]) == len(room.game.log)

    run(main())


def test_host_can_start_a_rematch():
    async def main():
        room, humans = await room_with(1, 3)
        await room.start(seed=4)
        await room.task
        first = room.game
        await room.start(seed=8)
        await room.task
        assert room.game is not first and room.game.result is not None

    run(main())


# ---------------------------------------------------------------- HTTP + websocket


def test_http_and_websocket_end_to_end():
    app = create_app(Settings(**FAST))
    with TestClient(app) as client:
        content = client.get("/api/content").json()
        assert content["cards"]["strike"]["title"] == "Strike"
        assert any(h["id"] == "wei_lie" for h in content["heroes"])
        assert client.get("/").status_code == 200

        host = client.post("/api/rooms", json={"name": "Host"}).json()
        code = host["code"]
        guest = client.post(f"/api/rooms/{code.lower()}/join", json={"name": "Guest"}).json()
        assert guest["seat"] == 1
        assert client.post("/api/rooms/ZZZZZ/join", json={"name": "x"}).status_code == 404
        assert client.get(f"/api/rooms/{code}").json()["members"][1]["name"] == "Guest"

        with client.websocket_connect(f"/ws/{code}?token=bad") as ws:
            assert ws.receive_json()["fatal"] is True

        with client.websocket_connect(f"/ws/{code}?token={host['token']}") as ws:
            assert ws.receive_json()["type"] == "room"
            ws.send_text("not json")
            assert ws.receive_json()["type"] == "error"
            for _ in range(3):
                ws.send_json({"type": "add_bot"})
                assert ws.receive_json()["members"][-1]["bot"] is True
            ws.send_json({"type": "start"})
            result = None
            for _ in range(20000):
                msg = ws.receive_json()
                if msg["type"] == "request":
                    ws.send_json({"type": "answer", "id": msg["id"], "answer": json_default(msg["request"])})
                elif msg["type"] == "state" and msg["view"]["result"]:
                    result = msg["view"]["result"]
                    break
            assert result is not None
