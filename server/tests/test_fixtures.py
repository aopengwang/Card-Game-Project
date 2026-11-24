"""The gallery fixture dumper must keep working as the engine and bots change."""
import json

from tools.dump_fixtures import SCENARIOS, dump


def test_every_scenario_is_found_and_shaped_like_a_client_state(tmp_path):
    paths = dump(tmp_path)
    assert len(paths) == len(SCENARIOS)
    for path in paths:
        fx = json.loads(path.read_text(encoding="utf-8"))
        you = fx["view"]["you"]
        assert fx["room"]["you"] == you and len(fx["room"]["members"]) == fx["players"]
        assert not fx["room"]["members"][you]["bot"]
        assert all("hand" not in p for p in fx["view"]["players"])  # only your own hand
        if fx["request"] is not None:
            assert fx["request"]["req"]["seat"] == you
        if fx["id"] == "game_over":
            assert fx["view"]["result"] is not None and fx["room"]["status"] == "finished"
        if fx["id"] == "watching":
            assert fx["request"] is None and fx["waiting"]["seat"] != you


def test_dump_is_reproducible(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    dump(a, ["nullify_chain", "eight_players"])
    dump(b, ["nullify_chain", "eight_players"])
    for name in ("nullify_chain.json", "eight_players.json"):
        assert (a / name).read_text(encoding="utf-8") == (b / name).read_text(encoding="utf-8")
