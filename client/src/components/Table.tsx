import { useState } from "react";
import { titleCase } from "../content";
import { recentPlays } from "../describe";
import { opponentOrder, seatPositions } from "../layout";
import { leave, type NetState } from "../net";
import { EMPTY, cardClickable, clickCard, clickSeat, seatClickable, type Selection } from "../selection";
import { ActionBar } from "./ActionBar";
import { CardView } from "./CardView";
import { GameOver, HeroPick, LogPanel } from "./Overlays";
import { Seat } from "./Seat";

const WAIT_LABEL: Record<string, string> = {
  play: "to play",
  discard: "to discard",
  choose_hero: "to choose a hero",
  choose_card: "to choose a card",
  choose_player: "to choose a player",
  choose_option: "to decide",
  confirm: "to decide",
};

export function Table({ net }: { net: NetState }) {
  const { room, view, request, waiting, log } = net;
  const [selState, setSelState] = useState<{ id: number | null; sel: Selection }>({ id: null, sel: EMPTY });
  const [showLog, setShowLog] = useState(false);
  const [hideResultFor, setHideResultFor] = useState<number | null>(null);
  if (!room || !view) return null;

  const req = request?.req ?? null;
  const sel = request && selState.id === request.id ? selState.sel : EMPTY;
  const setSel = (s: Selection) => setSelState({ id: request?.id ?? null, sel: s });
  const name = (seat: number | null | undefined) =>
    seat == null ? "?" : seat === view.you ? "You" : room.members[seat]?.name ?? `Player ${seat + 1}`;
  const nameOf = (seat: number) => room.members[seat]?.name ?? `Player ${seat + 1}`;

  const n = view.players.length;
  const opponents = opponentOrder(view.you, n);
  const positions = seatPositions(opponents.length);
  const me = view.players[view.you];
  const lordSeat = view.players.find((p) => p.role === "lord")?.seat;

  const seatProps = (seat: number) => ({
    clickable: seatClickable(req, sel, seat),
    selected: sel.targets.includes(seat),
    onClick: req ? () => setSel(clickSeat(req, sel, seat)) : undefined,
    isCurrent: view.current === seat && !view.result,
    isWaitedOn: waiting?.seat === seat && !request,
    offline: !room.members[seat]?.connected,
  });

  const waitingText = view.result
    ? "The game is over."
    : waiting?.seat != null
      ? `Waiting for ${name(waiting.seat)} ${WAIT_LABEL[waiting.kind] ?? ""}…`
      : "Waiting for other players…";

  const plays = recentPlays(log);
  const resultKey = view.result ? log.length : null;

  return (
    <div className="table-screen">
      <header className="topbar">
        <span className="brand">Three Kingdoms Table</span>
        <span className="pill">Room {room.code}</span>
        <span className="pill">Turn {view.turn}</span>
        {view.phase && (
          <span className="pill">
            {name(view.current)}: {view.phase} phase
          </span>
        )}
        {net.conn !== "open" && <span className="pill warn">reconnecting…</span>}
        <span className="spacer" />
        <button className="log-toggle" onClick={() => setShowLog(!showLog)}>
          {showLog ? "Hide log" : "Log"}
        </button>
        <button onClick={() => window.confirm("Leave this game? A bot will play your seat.") && leave()}>Leave</button>
      </header>

      <div className="table-main">
        <div className="arena">
          {opponents.map((seat, i) => (
            // The slot does the positioning, so the seat's own transforms (press, shake) can't move it.
            <div key={seat} className="seat-slot" style={{ left: `${positions[i].x}%`, top: `${positions[i].y}%` }}>
              <Seat player={view.players[seat]} name={nameOf(seat)} {...seatProps(seat)} />
            </div>
          ))}
          <div className="center">
            <div className="piles">
              <span className="pile" title="Draw pile">
                Deck {view.draw_pile}
              </span>
              <span className="pile" title="Discard pile">
                Discard {view.discard_pile}
              </span>
            </div>
            <div className="plays">
              {plays.length === 0 && (
                <span className="muted small">{view.current === view.you ? "Your turn" : `${name(view.current)}'s turn`}</span>
              )}
              {plays.map((p) => (
                <div key={p.key} className="play-slot">
                  <CardView card={p.card} size="sm" />
                  <span className="play-by">{p.seat != null ? name(p.seat) : ""}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className={`log-panel ${showLog ? "open" : ""}`}>
          <LogPanel log={log} name={name} />
        </aside>
      </div>

      <footer className="dock">
        <Seat player={me} name={nameOf(view.you)} isYou {...seatProps(view.you)} offline={false} />
        <div className="dock-main">
          <ActionBar request={request} view={view} sel={sel} setSel={setSel} name={name} waitingText={waitingText} />
          <div className="hand" aria-label="Your hand">
            {view.hand.length === 0 && <span className="muted small">No cards in hand.</span>}
            {view.hand.map((c) => {
              const clickable = cardClickable(req, sel, c.id);
              const selected = sel.cards.includes(c.id) || (sel.mode?.type === "card" && sel.mode.cardId === c.id);
              return (
                <CardView
                  key={c.id}
                  card={c}
                  clickable={clickable}
                  selected={selected}
                  dim={!!req && !clickable && req.kind !== "choose_hero"}
                  onClick={() => req && setSel(clickCard(req, sel, c.id))}
                />
              );
            })}
          </div>
          <div className="muted small">
            Attack range {view.attack_range}
            {me.skills.length > 0 && ` · Skills: ${me.skills.map((s) => titleCase(s.id)).join(", ")}`}
          </div>
        </div>
      </footer>

      {req?.kind === "choose_hero" && <HeroPick req={req} isLordPick={lordSeat === view.you} />}
      {view.result && hideResultFor !== resultKey && (
        <GameOver view={view} room={room} name={nameOf} onClose={() => setHideResultFor(resultKey)} />
      )}
      <Toasts toasts={net.toasts} />
    </div>
  );
}

export function Toasts({ toasts }: { toasts: { id: number; text: string }[] }) {
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}
