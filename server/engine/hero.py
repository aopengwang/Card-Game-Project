from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .events import SkillBase


class Kingdom(StrEnum):
    WEI = "wei"
    SHU = "shu"
    WU = "wu"
    QUN = "qun"


@dataclass(frozen=True)
class Hero:
    id: str
    name: str
    kingdom: Kingdom
    max_hp: int
    gender: str  # "male" | "female"
    skills: tuple[SkillBase, ...] = ()

    @property
    def has_lord_skill(self) -> bool:
        return any(s.lord for s in self.skills)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "kingdom": str(self.kingdom),
            "max_hp": self.max_hp,
            "gender": self.gender,
            "skills": [skill_info(s) for s in self.skills],
        }


def skill_info(s: SkillBase) -> dict:
    tags = [t for t in ("locked", "lord", "limited", "awakening") if getattr(s, t)]
    return {"id": s.name, "tags": tags, "text": (type(s).__doc__ or "").strip()}
