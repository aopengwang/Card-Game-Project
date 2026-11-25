// Animation lab (developer tool): /?fx[=effect]&lang=zh (effects: kill, streak, double, fate, strike, heal, judge, judgeGood, judgeMiss, judgeKill, turn). Replays table effects on a real
// captured table, with the seats and speed you choose, so an animation can be tuned in
// seconds instead of playing games until the moment comes up. Press P to replay.
import { useEffect, useRef, useState } from "react";
import { heroInfo, useContent } from "../content";
import { Table } from "../components/Table";
import { setFxSpeed } from "../fx/stage";
import { useLang } from "../i18n";
import type { NetState } from "../net";
import type { GameView, LogEntry } from "../types";
import { FIXTURES, fixtureNet } from "./fixtures";
import s from "./FxLab.module.css";

type Seats = { killer: number; victim: number; second: number; you: number };
type Step = { entries: LogEntry[]; view?: (v: GameView) => GameView; after?: number };
type Role = "killer" | "victim" | "second";

let nextCardId = 9000;
const use = (seat: number, name: string, targets: number[]): LogEntry => ({
  type: "use",
  seat,
  card: { id: nextCardId++, name, suit: "spade", rank: 7 },
  targets,
});
const damage = (source: number | null, target: number, hp: number, nature = "normal"): LogEntry => ({
  type: "damage",
  source,
  target,
  amount: 1,
  nature,
  hp,
});
const death = (v: GameView, seat: number, killer: number | null): LogEntry => ({
  type: "death",
  seat,
  role: v.players[seat].role ?? "rebel",
  killer,
});
const judged = (seat: number, reason: string, suit: string, rank: number, hit: boolean): LogEntry => ({
  type: "judge_result",
  seat,
  reason,
  card: { id: nextCardId++, name: suit === "heart" ? "peach" : "dodge", suit, rank },
  hit,
});
const setHp = (seats: number[], hp: number) => (v: GameView) => ({
  ...v,
  players: v.players.map((p) => (seats.includes(p.seat) ? { ...p, hp } : p)),
});
const dies = (seats: number[]) => (v: GameView) => ({
  ...v,
  players: v.players.map((p) => (seats.includes(p.seat) ? { ...p, hp: 0, alive: false, role: p.role ?? "rebel" } : p)),
});

const killSteps = ({ killer, victim }: Seats, v: GameView): Step[] => [
  {
    entries: [use(killer, "strike", [victim]), damage(killer, victim, 0), { type: "dying", seat: victim, hp: 0 }],
    view: setHp([victim], 0),
    after: 900,
  },
  { entries: [death(v, victim, killer)], view: dies([victim]) },
];

interface Effect {
  label: string;
  uses: Role[];
  steps: (s: Seats, v: GameView) => Step[];
  /** Earlier events already in the log when it starts (counted, not replayed). */
  prelude?: (s: Seats, v: GameView, kills: number) => LogEntry[];
  /** Offers a "kills so far" choice. */
  streak?: boolean;
}

/** Each effect as the log entries a real game would send, in steps (`after`: ms to the next). */
const EFFECTS: Record<string, Effect> = {
  kill: { label: "Killing blow", uses: ["killer", "victim"], steps: killSteps },
  streak: {
    label: "Kill streak",
    uses: ["killer", "victim"],
    streak: true,
    // the killer's earlier kills this game, so this one makes the chosen streak
    prelude: ({ killer, victim }, v, kills) => {
      const others = v.players.map((p) => p.seat).filter((s) => s !== killer && s !== victim);
      return Array.from({ length: kills - 1 }, (_, i) => death(v, others[i % others.length], killer));
    },
    steps: killSteps,
  },
  double: {
    label: "Two fall at once (they queue)",
    uses: ["killer", "victim", "second"],
    steps: ({ killer, victim, second }, v) => [
      {
        entries: [use(killer, "arrows", [victim, second]), damage(killer, victim, 0), damage(killer, second, 0)],
        view: setHp([victim, second], 0),
        after: 900,
      },
      { entries: [death(v, victim, killer), death(v, second, killer)], view: dies([victim, second]) },
    ],
  },
  fate: {
    label: "Death with no killer (Lightning)",
    uses: ["victim"],
    steps: ({ victim }, v) => [
      { entries: [damage(null, victim, 0, "thunder")], view: setHp([victim], 0), after: 700 },
      { entries: [death(v, victim, null)], view: dies([victim]) },
    ],
  },
  strike: {
    label: "Strike and damage",
    uses: ["killer", "victim"],
    steps: ({ killer, victim }, v) => {
      const hp = Math.max(1, v.players[victim].hp - 1);
      return [{ entries: [use(killer, "strike", [victim]), damage(killer, victim, hp)], view: setHp([victim], hp) }];
    },
  },
  heal: {
    label: "Peach (healing)",
    uses: ["victim"],
    steps: ({ victim }, v) => {
      const hp = v.players[victim].hp + 1;
      return [{ entries: [use(victim, "peach", []), { type: "recover", seat: victim, amount: 1, hp }], view: setHp([victim], hp) }];
    },
  },
  judge: {
    label: "Judgment: Indulgence hits (bad news)",
    uses: ["victim"],
    steps: ({ victim }) => [{ entries: [judged(victim, "indulgence", "spade", 9, true)] }],
  },
  judgeGood: {
    label: "Judgment: Eight Trigrams hits (good news)",
    uses: ["victim"],
    steps: ({ victim }) => [{ entries: [judged(victim, "eight_trigrams", "heart", 4, true)] }],
  },
  judgeMiss: {
    label: "Judgment: Lightning misses (good news)",
    uses: ["victim"],
    steps: ({ victim }) => [{ entries: [judged(victim, "lightning", "heart", 12, false)] }],
  },
  judgeKill: {
    label: "Judgment: Lightning hits and kills (they queue)",
    uses: ["victim"],
    steps: ({ victim }, v) => [
      {
        entries: [judged(victim, "lightning", "spade", 5, true), { ...damage(null, victim, 0, "thunder"), amount: 3 }],
        view: setHp([victim], 0),
        after: 600,
      },
      { entries: [death(v, victim, null)], view: dies([victim]) },
    ],
  },
  turn: {
    label: "Your turn banner",
    uses: [],
    steps: ({ you }) => [{ entries: [{ type: "turn_start", seat: you, turn: 99 }] }],
  },
};

const ROLE_LABEL: Record<Role, string> = { killer: "Killer / source", victim: "Victim / target", second: "Second victim" };
const SPEEDS = [1, 0.5, 0.25] as const;

/** A table at rest: a real six-player moment, nobody asked anything. */
function baseNet(): NetState {
  const fx = FIXTURES.find((f) => f.id === "play_strike") ?? FIXTURES[0];
  return { ...fixtureNet(fx), request: null, waiting: null };
}

export default function FxLab({ initial }: { initial: string }) {
  useLang();
  useContent();
  const [base] = useState(baseNet);
  const view = base.view!;
  const [net, setNet] = useState(base);
  const [run, setRun] = useState(0); // remounts the table: every replay starts from the same moment
  const [effect, setEffect] = useState(initial in EFFECTS ? initial : "kill");
  const [seats, setSeats] = useState<Seats>(() => {
    const others = view.players.filter((p) => p.alive && p.seat !== view.you).map((p) => p.seat);
    return { you: view.you, killer: others[0], victim: others[1], second: others[3] ?? others[2] };
  });
  const [speed, setSpeed] = useState<number>(1);
  const [kills, setKills] = useState(3);
  const [open, setOpen] = useState(true);
  const timers = useRef<number[]>([]);

  useEffect(() => setFxSpeed(speed), [speed]);
  useEffect(() => () => setFxSpeed(1), []);

  const replay = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const prelude = EFFECTS[effect].prelude?.(seats, view, kills) ?? [];
    setNet({ ...base, log: [...base.log, ...prelude] });
    setRun((r) => r + 1);
    let at = 150; // the fresh table mounts and measures first
    for (const st of EFFECTS[effect].steps(seats, view)) {
      timers.current.push(
        window.setTimeout(() => setNet((n) => ({ ...n, log: [...n.log, ...st.entries], view: st.view ? st.view(n.view!) : n.view })), at),
      );
      at += (st.after ?? 0) / speed;
    }
  };
  const replayRef = useRef(replay);
  replayRef.current = replay;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "p" || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as Element).closest("input, select, textarea")) return;
      e.preventDefault();
      replayRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const seatName = (seat: number) => {
    const hero = heroInfo(view.players[seat].hero)?.name ?? view.players[seat].hero;
    return `${seat === view.you ? "You" : `Seat ${seat}`} · ${hero}`;
  };

  return (
    <>
      <Table key={run} net={net} />
      <section className={`${s.panel} fx-lab`} aria-label="Animation lab">
        <div className={s.head}>
          <b className={s.title}>Animation lab</b>
          <a className={s.link} href="?gallery">Gallery</a>
          <button type="button" className={s.toggle} onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Hide" : "Show"}
          </button>
        </div>
        {open && (
          <div className={s.body}>
            <label className={s.field}>
              <span>Effect</span>
              <select value={effect} onChange={(e) => setEffect(e.target.value)} aria-label="Effect">
                {Object.entries(EFFECTS).map(([id, fx]) => (
                  <option key={id} value={id}>
                    {fx.label}
                  </option>
                ))}
              </select>
            </label>
            {EFFECTS[effect].uses.map((role) => (
              <label key={role} className={s.field}>
                <span>{ROLE_LABEL[role]}</span>
                <select
                  value={seats[role]}
                  onChange={(e) => setSeats({ ...seats, [role]: Number(e.target.value) })}
                  aria-label={ROLE_LABEL[role]}
                >
                  {view.players.map((p) => (
                    <option key={p.seat} value={p.seat}>
                      {seatName(p.seat)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {EFFECTS[effect].streak && (
              <label className={s.field}>
                <span>Kills</span>
                <select value={kills} onChange={(e) => setKills(Number(e.target.value))} aria-label="Kills">
                  {[2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className={s.field}>
              <span>Speed</span>
              <div className={s.speeds} role="group" aria-label="Speed">
                {SPEEDS.map((sp) => (
                  <button key={sp} type="button" aria-pressed={speed === sp} onClick={() => setSpeed(sp)}>
                    {sp === 1 ? "1×" : `${sp}×`}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className={s.play} onClick={replay}>
              Play <kbd>P</kbd>
            </button>
          </div>
        )}
      </section>
    </>
  );
}
