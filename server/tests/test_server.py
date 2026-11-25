import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from bots import SimpleBot
from content.heroes import HERO_MAP
from engine import HAND, ArrangeRequest, ChoosePlayerRequest, Convert, Play, PlayOption, PlayRequest, RespondRequest
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
        case "arrange":
            return {"top": r["options"], "bottom": []}
        case _:
            return None  # play: end phase; respond: pass


def to_json(a):
    if isinstance(a, Play):
        return {"card_id": a.card_id, "targets": list(a.targets), "skill": a.skill, "cards": list(a.cards)}
    if isinstance(a, Convert):
        return {"skill": a.skill, "cards": list(a.cards)}
    if isinstance(a, tuple) and len(a) == 2 and all(isinstance(x, tuple) for x in a):  # arrange: (top, bottom)
        return {"top": list(a[0]), "bottom": list(a[1])}
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
    assert parse_answer(play, {"skill": "rivalry", "cards": [4], "targets": [2, 3]}) == Play(None, (2, 3), "rivalry", (4,))
    resp = RespondRequest(seat=0, card_name="dodge", reason="strike", options=[1])
    assert parse_answer(resp, 1) == 1
    assert parse_answer(resp, {"skill": "serpent_spear", "cards": [1, 2]}) == Convert("serpent_spear", (1, 2))
    for bad in [{"card_id": [1]}, {"card_id": True}, "x", {"targets": "1"}]:
        with pytest.raises(ProtocolError):
            parse_answer(play, bad)
    # optional player picks may answer null; arranging the deck sends top and bottom
    pick = ChoosePlayerRequest(seat=0, reason="night_raid", options=[1, 2], optional=True)
    assert parse_answer(pick, None) is None and pick.validate(None) is None and pick.default() is None
    arrange = ArrangeRequest(seat=0, reason="star_chart", options=[5, 6, 7])
    answer = parse_answer(arrange, {"top": [7, 5], "bottom": [6]})
    assert answer == ((7, 5), (6,)) and arrange.validate(answer) is None
    assert arrange.validate(((7,), (6,))) == "place every card exactly once"
    with pytest.raises(ProtocolError):
        parse_answer(arrange, [7, 5, 6])


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
        assert g.of("room")[-1]["members"][1] == {"name": "P1", "bot": False, "level": None, "connected": True}

    run(main())


def test_bot_levels():
    async def main():
        room, (host,) = await room_with(1, 0)
        c = await FakeClient(room, host).connect()
        await room.handle(host, c.conn, {"type": "add_bot", "level": "easy"})
        await room.handle(host, c.conn, {"type": "add_bot"})  # default: hard
        with pytest.raises(RoomError, match="unknown bot level"):
            await room.handle(host, c.conn, {"type": "add_bot", "level": "godlike"})
        info = c.of("room")[-1]
        assert [m["level"] for m in info["members"]] == [None, "easy", "hard"]
        assert info["bot_levels"] == ["easy", "hard"]
        room.add_bot("hard")
        await room.start(seed=1)
        assert [type(b).__name__ for b in room.bots] == ["SmartBot", "SimpleBot", "SmartBot", "SmartBot"]
        await room.close()

    run(main())


def test_host_changes_game_settings():
    async def main():
        room, (host, guest) = await room_with(2, 2)
        h = await FakeClient(room, host).connect()
        g = await FakeClient(room, guest, auto=False).connect()
        info = h.of("room")[-1]
        assert info["options"] == {"play_timeout": 5, "response_timeout": 5, "hero_timeout": 5, "bot_delay": 0.0}
        assert info["option_limits"]["play_timeout"] == [15, 300]

        await room.handle(host, h.conn, {"type": "settings", "settings": {"play_timeout": 120, "response_timeout": 10}})
        assert g.of("room")[-1]["options"]["play_timeout"] == 120  # everyone sees the change
        assert room.options.response_timeout == 10

        with pytest.raises(RoomError, match="only the host"):
            await room.handle(guest, g.conn, {"type": "settings", "settings": {"play_timeout": 60}})
        for bad, why in [
            ({"play_timeout": 5}, "between 15 and 300"),
            ({"play_timeout": True}, "number"),
            ({"turbo": 1}, "unknown setting"),
            ({"play_timeout": 60, "bot_delay": 99}, "between 0 and 3"),
        ]:
            with pytest.raises(RoomError, match=why):
                await room.handle(host, h.conn, {"type": "settings", "settings": bad})
        assert room.options.play_timeout == 120  # all-or-nothing: the 60 above wasn't applied

        # the timeout actually used for a guest's request comes from the room's options
        await room.start(seed=2)
        with pytest.raises(RoomError, match="during a game"):
            await room.handle(host, h.conn, {"type": "settings", "settings": {"play_timeout": 60}})
        for _ in range(200):
            if g.of("request"):
                break
            await asyncio.sleep(0.01)
        req = g.of("request")[0]
        expected = {"play": 120, "choose_hero": 5, "discard": 5}.get(req["request"]["kind"], 10)
        assert expected - 1 < req["timeout"] <= expected
        await room.close()

    run(main())


def test_host_chooses_which_heroes_can_be_picked():
    async def main():
        room, (host, guest) = await room_with(2, 3)  # 5 players
        h = await FakeClient(room, host).connect()
        g = await FakeClient(room, guest).connect()
        assert h.of("room")[-1]["disabled_heroes"] == []

        total = len(HERO_MAP)
        off = sorted(HERO_MAP)[: total - 5]  # 5 left on
        await room.handle(host, h.conn, {"type": "heroes", "disabled": off})
        assert g.of("room")[-1]["disabled_heroes"] == off  # everyone sees it

        with pytest.raises(RoomError, match="only the host"):
            await room.handle(guest, g.conn, {"type": "heroes", "disabled": []})
        for bad, why in [
            (sorted(HERO_MAP)[: total - 3], "at least 4 heroes"),
            (["nobody"], "unknown hero"),
            ("cao_cao", "list of hero ids"),
        ]:
            with pytest.raises(RoomError, match=why):
                await room.handle(host, h.conn, {"type": "heroes", "disabled": bad})
        assert room.disabled_heroes == set(off)  # a bad list changes nothing

        # 5 players need 5 heroes: with one more off, the game can't start
        await room.handle(host, h.conn, {"type": "heroes", "disabled": sorted(HERO_MAP)[: total - 4]})
        with pytest.raises(RoomError, match="enable at least 5 heroes"):
            await room.start(seed=3)
        await room.handle(host, h.conn, {"type": "heroes", "disabled": off})

        # every hero offered in the draft is an enabled one
        await room.start(seed=3)
        with pytest.raises(RoomError, match="during a game"):
            await room.handle(host, h.conn, {"type": "heroes", "disabled": []})
        for _ in range(1000):
            if room.status == "finished" or any(e["type"] == "heroes_revealed" for e in room.game.log):
                break
            await asyncio.sleep(0.01)
        assert {p.hero for p in room.game.players} == set(HERO_MAP) - set(off)
        await room.close()

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
        assert client.get("/debug").status_code == 200

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
            assert ws.receive_json() == {"type": "chat_history", "messages": []}
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


def test_room_password_over_http():
    app = create_app(Settings(**FAST))
    with TestClient(app) as client:
        host = client.post("/api/rooms", json={"name": "Host"}).json()
        code = host["code"]
        room = app.state.rooms.get(code)
        assert client.get(f"/api/rooms/{code}").json()["locked"] is False
        room.set_password("plum blossom")
        assert client.get(f"/api/rooms/{code}").json()["locked"] is True
        assert "password" not in client.get(f"/api/rooms/{code}").json()  # never shown to outsiders

        r = client.post(f"/api/rooms/{code}/join", json={"name": "A"})
        assert (r.status_code, r.json()["detail"]) == (403, "this room needs a password")
        r = client.post(f"/api/rooms/{code}/join", json={"name": "A", "password": "plum"})
        assert (r.status_code, r.json()["detail"]) == (403, "wrong password")
        r = client.post(f"/api/rooms/{code}/join", json={"name": "A", "password": "plum blossom"})
        assert r.status_code == 200 and r.json()["seat"] == 1

        # guessing is limited: after 10 wrong tries a minute, even the right one waits
        for _ in range(9):
            client.post(f"/api/rooms/{code}/join", json={"name": "B", "password": "nope"})
        r = client.post(f"/api/rooms/{code}/join", json={"name": "B", "password": "plum blossom"})
        assert r.status_code == 429 and "too many" in r.json()["detail"]

        # reconnecting with your own token never needs the password
        with client.websocket_connect(f"/ws/{code}?token={host['token']}") as ws:
            info = ws.receive_json()
            assert info["type"] == "room" and info["locked"] is True and info["password"] == "plum blossom"


def test_host_sets_the_password_and_only_the_host_sees_it():
    async def main():
        room, (host, guest) = await room_with(2, 0)
        h = await FakeClient(room, host).connect()
        g = await FakeClient(room, guest).connect()
        await room.handle(host, h.conn, {"type": "password", "password": "secret"})
        assert h.of("room")[-1]["password"] == "secret" and h.of("room")[-1]["locked"] is True
        assert "password" not in g.of("room")[-1] and g.of("room")[-1]["locked"] is True
        with pytest.raises(RoomError, match="only the host"):
            await room.handle(guest, g.conn, {"type": "password", "password": "mine"})
        for bad, why in [(123, "must be text"), ("   ", "must be text"), ("x" * 41, "at most 40")]:
            with pytest.raises(RoomError, match=why):
                await room.handle(host, h.conn, {"type": "password", "password": bad})
        assert room.password == "secret"
        await room.handle(host, h.conn, {"type": "password", "password": None})  # removed
        assert room.password is None and g.of("room")[-1]["locked"] is False
        await room.close()

    run(main())


def test_chat_reaches_everyone_and_is_kept_for_reconnects():
    async def main():
        room, (host, guest) = await room_with(2, 2)
        h = await FakeClient(room, host).connect()
        g = await FakeClient(room, guest).connect()
        await room.handle(guest, g.conn, {"type": "chat", "text": "  hello   <b>everyone</b>  "})
        msg = h.of("chat")[-1]
        assert (msg["seat"], msg["name"], msg["text"]) == (1, "P1", "hello <b>everyone</b>")  # text as-is
        assert g.of("chat")[-1]["id"] == msg["id"]

        await room.handle(host, h.conn, {"type": "chat", "text": "x" * 500})
        assert len(h.of("chat")[-1]["text"]) == 200  # long ones are cut
        for bad in ["", "   ", 5, None]:
            with pytest.raises(RoomError):
                await room.handle(host, h.conn, {"type": "chat", "text": bad})

        # flooding is slowed down: 5 messages per 10 seconds (the guest has sent 1)
        for i in range(4):
            await room.handle(guest, g.conn, {"type": "chat", "text": f"spam {i}"})
        with pytest.raises(RoomError, match="too fast"):
            await room.handle(guest, g.conn, {"type": "chat", "text": "one more"})

        # whoever (re)connects gets the conversation so far, in the game too
        await room.start(seed=1)
        late = await FakeClient(room, guest).connect()
        history = late.of("chat_history")[-1]["messages"]
        assert [m["text"] for m in history][-1] == "spam 3" and len(history) == 6
        await room.close()

    run(main())


def test_art_manifest_lists_dropped_in_images(tmp_path):
    art = tmp_path / "art"
    (art / "cards").mkdir(parents=True)
    (art / "heroes").mkdir()
    (art / "cards" / "strike.webp").write_bytes(b"RIFF....WEBP")
    (art / "cards" / "notes.txt").write_text("not an image")
    (art / "heroes" / "wei_lie.png").write_bytes(b"\x89PNG")
    app = create_app(Settings(**FAST), client_dist=tmp_path / "nodist", art_dir=art)
    with TestClient(app) as client:
        m = client.get("/api/art").json()
        assert set(m["cards"]) == {"strike"} and set(m["heroes"]) == {"wei_lie"}
        assert m["cards"]["strike"].startswith("/art/cards/strike.webp?v=")
        assert client.get(m["cards"]["strike"]).content == b"RIFF....WEBP"  # served, no rebuild
        # a new file shows up on the next request (no restart)
        (art / "cards" / "peach.jpg").write_bytes(b"\xff\xd8")
        assert "peach" in client.get("/api/art").json()["cards"]


def test_serves_built_client_when_present(tmp_path):
    (tmp_path / "index.html").write_text("<html>built client</html>")
    (tmp_path / "art").mkdir()
    app = create_app(Settings(**FAST), client_dist=tmp_path, art_dir=tmp_path / "art")
    with TestClient(app) as client:
        assert "built client" in client.get("/").text
        assert "built client" in client.get("/?room=ABCDE").text
        assert client.get("/art/cards/strike.png").status_code == 404  # missing art -> client fallback
        assert client.get("/api/content").status_code == 200  # API still wins over the mount
        assert "Cardgame" in client.get("/debug").text
