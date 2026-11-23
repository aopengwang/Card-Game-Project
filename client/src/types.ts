// Mirrors server/engine/view.py, server/engine/requests.py and server/net/room.py.

export type Suit = "spade" | "heart" | "club" | "diamond" | "none";

export interface Card {
  id: number;
  name: string;
  suit: Suit;
  rank: number;
  virtual?: boolean;
  color?: "red" | "black" | "none";
}

export interface SkillInfo {
  id: string;
  tags: string[];
  text: string;
  title?: string;
}

export interface PlayerView {
  seat: number;
  hero: string;
  kingdom: string;
  gender: string;
  skills: SkillInfo[];
  spent: string[];
  skill_uses: Record<string, number>;
  distance: number | null;
  hp: number;
  max_hp: number;
  alive: boolean;
  hand_count: number;
  equips: Card[];
  judge: Card[];
  role: string | null;
}

export interface GameView {
  you: number;
  turn: number;
  current: number;
  phase: string | null;
  draw_pile: number;
  discard_pile: number;
  processing: Card[];
  attack_range: number;
  players: PlayerView[];
  hand: Card[];
  result: { side: string; winners: number[] } | null;
}

export interface Waiting {
  seat: number | null;
  kind: string;
}

export interface RoomMember {
  name: string;
  bot: boolean;
  level: string | null; // bot difficulty ("easy" | "hard"), null for humans
  connected: boolean;
}

export interface RoomInfo {
  code: string;
  status: "lobby" | "playing" | "finished";
  you: number | null;
  host: number | null;
  members: RoomMember[];
  min_players: number;
  max_players: number;
  bot_levels?: string[];
}

// ---- requests (the `kind` field discriminates)

interface Base {
  seat: number;
  error: string | null;
}

export interface PlayOption {
  card_id: number;
  target_count: number;
  candidates: number[];
  min_targets: number | null;
}

export interface ConvertOption {
  skill: string;
  as_name: string;
  count: number;
  cards: number[];
  target_count: number;
  candidates: number[];
  min_targets: number | null;
}

export interface SkillOption {
  skill: string;
  min_cards: number;
  max_cards: number;
  cards: number[];
  min_targets: number;
  target_count: number;
  candidates: number[];
}

export interface PlayReq extends Base {
  kind: "play";
  options: PlayOption[];
  conversions: ConvertOption[];
  skills: SkillOption[];
}

export interface RespondReq extends Base {
  kind: "respond";
  card_name: string;
  reason: string;
  about: number | null;
  options: number[];
  conversions: ConvertOption[];
  context: Record<string, unknown>;
}

export interface DiscardReq extends Base {
  kind: "discard";
  count: number;
  options: number[];
  reason: string;
}

export interface ChooseCardReq extends Base {
  kind: "choose_card";
  reason: string;
  about: number | null;
  options: number[];
  hidden_count: number;
  optional: boolean;
}

export interface ConfirmReq extends Base {
  kind: "confirm";
  reason: string;
  about: number | null;
  context: Record<string, unknown>;
}

export interface ChoosePlayerReq extends Base {
  kind: "choose_player";
  reason: string;
  about: number | null;
  options: number[];
}

export interface ChooseOptionReq extends Base {
  kind: "choose_option";
  reason: string;
  about: number | null;
  choices: string[];
}

export interface ChooseHeroReq extends Base {
  kind: "choose_hero";
  options: string[];
}

export type GameRequest =
  | PlayReq
  | RespondReq
  | DiscardReq
  | ChooseCardReq
  | ConfirmReq
  | ChoosePlayerReq
  | ChooseOptionReq
  | ChooseHeroReq;

export interface ActiveRequest {
  id: number;
  req: GameRequest;
  deadline: number; // Date.now() ms
  total: number; // ms
}

export type LogEntry = { type: string } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---- content (/api/content)

export interface CardInfo {
  title: string;
  type: "basic" | "trick" | "equipment";
  text: string;
  slot?: string;
  range?: number;
}

export interface HeroInfo {
  id: string;
  name: string;
  kingdom: string;
  max_hp: number;
  gender: string;
  skills: SkillInfo[];
}

export interface Content {
  lang?: string;
  cards: Record<string, CardInfo>;
  heroes: HeroInfo[];
  skills: Record<string, SkillInfo>;
}
