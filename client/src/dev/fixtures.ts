// Real game states captured by `python -m tools.dump_fixtures` (server/tools/dump_fixtures.py).
import type { NetState } from "../net";
import type { GameRequest, GameView, LogEntry, RoomInfo, Waiting } from "../types";

export interface Fixture {
  id: string;
  title: string;
  seed: number;
  players: number;
  room: RoomInfo;
  view: GameView;
  log: LogEntry[];
  waiting: Waiting | null;
  request: { id: number; req: GameRequest; timeout: number } | null;
}

const modules = import.meta.glob<Fixture>("./fixtures/*.json", { eager: true, import: "default" });

// Declared before FIXTURES: the sort below runs at module load.
const ORDER = [
  "hero_pick", "play_strike", "play_skill", "respond_dodge", "nullify_chain", "dying_self",
  "discard_phase", "choose_card", "confirm_armor", "watching", "eight_players", "game_over",
];
const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);

/** All fixtures, in the order the dumper defines them (unknown ones last, by id). */
export const FIXTURES: Fixture[] = Object.values(modules).sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));

/** The client state a player would have at that moment (no live connection). */
export function fixtureNet(fx: Fixture): NetState {
  const total = (fx.request?.timeout ?? 0) * 1000;
  return {
    session: { code: fx.room.code, token: "gallery" },
    conn: "open",
    room: fx.room,
    view: fx.view,
    waiting: fx.waiting,
    request: fx.request ? { id: fx.request.id, req: fx.request.req, deadline: Date.now() + total, total } : null,
    log: fx.log,
    toasts: [],
    homeError: null,
  };
}
