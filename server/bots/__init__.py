from .simple import SimpleBot
from .smart import SmartBot

BOT_LEVELS = {"easy": SimpleBot, "hard": SmartBot}


def make_bot(level: str, seed: int = 0):
    return BOT_LEVELS[level](seed)


__all__ = ["BOT_LEVELS", "SimpleBot", "SmartBot", "make_bot"]
