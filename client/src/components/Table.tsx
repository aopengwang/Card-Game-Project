import { useState } from "react";
import { skillTitle, useContent } from "../content";
import { recentPlays } from "../describe";
import { joinList, memberName, t, tMaybe, useLang } from "../i18n";
import { opponentOrder, seatPositions } from "../layout";
import { leave, type NetState } from "../net";
import { EMPTY, cardClickable, clickCard, clickSeat, seatClickable, type Selection } from "../selection";
import { ActionBar } from "./ActionBar";
import { CardView } from "./CardView";
import { LangToggle } from "./LangToggle";
import { GameOver, HeroPick, LogPanel } from "./Overlays";
import { Seat } from "./Seat";

export function Table({ net }: { net: NetState }) {
  useLang();
  useContent();
  const { room, view, request, waiting, log } = net;
  const [selState, setSelState] = useState<{ id: number | null; sel: Selection }>({ id: null, sel: EMPTY });
  const [showLog, setShowLog] = useState(false);
  const [hideResultFor, setHideResultFor] = useState<number | null>(null);
  if (!room || !view) return null;

  const req = request?.req ?? null;
  const sel = request && selState.id === request.id ? selState.sel : EMPTY;
  const setSel = (s: Selection) => setSelState({ id: request?.id ?? null, sel: s });
  const nameOf = (seat: number) => memberName(room.members[seat], seat);
  const name = (seat: number | null | undefined) => (seat == null ? "?" : seat === view.you ? t("name.you") : nameOf(seat));

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
    ? t("table.over")
    : waiting?.seat != null
      ? t("table.waitingFor", { name: name(waiting.seat), what: tMaybe(`wait.${waiting.kind}`) ?? "" })
      : t("table.waitingOthers");

  const plays = recentPlays(log);
  const resultKey = view.result ? log.length : null;

  return (
    <div className="table-screen">
      <header className="topbar">
        <span className="brand">{t("app.title")}</span>
        <span className="pill">{t("table.room", { code: room.code })}</span>
        <span className="pill">{t("table.turn", { n: view.turn })}</span>
        {view.phase && (
          <span className="pill">{t("table.phase", { name: name(view.current), phase: tMaybe(`phase.${view.phase}`) ?? view.phase })}</span>
        )}
        {net.conn !== "open" && <span className="pill warn">{t("conn.reconnecting")}</span>}
        <span className="spacer" />
        <LangToggle />
        <button className="log-toggle" onClick={() => setShowLog(!showLog)}>
          {showLog ? t("table.hideLog") : t("table.log")}
        </button>
        <button onClick={() => window.confirm(t("table.leaveConfirm")) && leave()}>{t("table.leave")}</button>
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
              <span className="pile" title={t("table.drawPile")}>
                {t("table.deck", { n: view.draw_pile })}
              </span>
              <span className="pile" title={t("table.discardPile")}>
                {t("table.discard", { n: view.discard_pile })}
              </span>
            </div>
            <div className="plays">
              {plays.length === 0 && (
                <span className="muted small">
                  {view.current === view.you ? t("table.yourTurn") : t("table.theirTurn", { name: name(view.current) })}
                </span>
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
          {/* Log lines are third-person sentences ("X draws 2"), so use real names there. */}
          <LogPanel log={log} name={(seat) => (seat == null ? "?" : nameOf(seat))} />
        </aside>
      </div>

      <footer className="dock">
        <Seat player={me} name={nameOf(view.you)} isYou {...seatProps(view.you)} offline={false} />
        <div className="dock-main">
          <ActionBar request={request} view={view} sel={sel} setSel={setSel} name={name} waitingText={waitingText} />
          <div className="hand" aria-label={t("table.hand")}>
            {view.hand.length === 0 && <span className="muted small">{t("table.noCards")}</span>}
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
            {t("table.range", { n: view.attack_range })}
            {me.skills.length > 0 && ` · ${t("table.skills", { list: joinList(me.skills.map((s) => skillTitle(s.id))) })}`}
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
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          {toast.text}
        </div>
      ))}
    </div>
  );
}
