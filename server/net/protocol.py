"""JSON <-> engine conversion for Requests and answers.

Outgoing: `request_to_dict` flattens any Request dataclass (dict-of-options
becomes a list). Incoming: `parse_answer` turns client JSON into the Python
answer the engine expects, raising ProtocolError for malformed input. Whether
the answer is *legal* is still decided by the engine (req.validate + checks).
"""
from __future__ import annotations

import dataclasses
from typing import Any

from engine import HAND, Convert, Play, Request


class ProtocolError(ValueError):
    pass


def _jsonable(v: Any) -> Any:
    if dataclasses.is_dataclass(v) and not isinstance(v, type):
        return {f.name: _jsonable(getattr(v, f.name)) for f in dataclasses.fields(v)}
    if isinstance(v, dict):
        if all(isinstance(k, int) for k in v):  # e.g. PlayRequest.options keyed by card id
            return [_jsonable(x) for x in v.values()]
        return {str(k): _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set, frozenset)):
        return [_jsonable(x) for x in v]
    return v


def request_to_dict(req: Request) -> dict[str, Any]:
    d: dict[str, Any] = {"kind": req.kind}
    for f in dataclasses.fields(req):
        d[f.name] = _jsonable(getattr(req, f.name))
    return d


def _int(x: Any) -> int:
    if isinstance(x, bool) or not isinstance(x, int):
        raise ProtocolError(f"expected an integer, got {x!r}")
    return x


def _ints(xs: Any) -> tuple[int, ...]:
    if not isinstance(xs, list):
        raise ProtocolError("expected a list of integers")
    return tuple(_int(x) for x in xs)


def _str(x: Any) -> str:
    if not isinstance(x, str):
        raise ProtocolError(f"expected a string, got {x!r}")
    return x


def parse_answer(req: Request, raw: Any) -> Any:
    """Convert a client's JSON answer for `req` into the engine's answer type."""
    kind = req.kind
    if kind == "play":
        if raw is None:
            return None
        if not isinstance(raw, dict):
            raise ProtocolError("play answer must be null or an object")
        skill = raw.get("skill")
        card_id = raw.get("card_id")
        return Play(
            card_id=None if card_id is None else _int(card_id),
            targets=_ints(raw.get("targets", [])),
            skill=None if skill is None else _str(skill),
            cards=_ints(raw.get("cards", [])),
        )
    if kind == "respond":
        if raw is None:
            return None
        if isinstance(raw, dict):
            return Convert(_str(raw.get("skill")), _ints(raw.get("cards", [])))
        return _int(raw)
    if kind == "choose_card":
        if raw is None or raw == HAND:
            return raw
        return _int(raw)
    if kind == "discard":
        return list(_ints(raw))
    if kind == "confirm":
        if not isinstance(raw, bool):
            raise ProtocolError("expected true or false")
        return raw
    if kind == "choose_player":
        return None if raw is None else _int(raw)
    if kind == "arrange":
        if not isinstance(raw, dict):
            raise ProtocolError("arrange answer must be {top: [...], bottom: [...]}")
        return (_ints(raw.get("top", [])), _ints(raw.get("bottom", [])))
    if kind in ("choose_option", "choose_hero"):
        return _str(raw)
    raise ProtocolError(f"unknown request kind {kind!r}")
