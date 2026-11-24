import { useState, type CSSProperties } from "react";
import { useContent } from "../content";
import { recentPlays } from "../describe";
import { memberName, t, tMaybe, useLang } from "../i18n";
import { handFan, opponentOrder, tableLayout } from "../layout";
import { leave, type NetState } from "../net";
import { EMPTY, cardClickable, clickCard, clickSeat, seatClickable, type Selection } from "../selection";
import { Button } from "../ui/Button";
import { Card, CardBack } from "../ui/Card";
import { Plaque } from "../ui/Plaque";
import { useSize } from "../useSize";
import { ActionBar } from "./ActionBar";
import { LangToggle } from "./LangToggle";
import { GameOver, HeroPick, LogPanel } from "./Overlays";

const LOG_KEY = "sgs.logOpen";

/** Log open/closed, remembered per browser. Default: open where there's room for it. */
function useLogOpen() {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(LOG_KEY);
      if (saved != null) return saved === "1";
    } catch {
      // storage unavailable (private mode): fall through to the default
    }
    return window.innerWidth >= 1280;
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(LOG_KEY, open ? "0" : "1");
    } catch {
      // not remembered, that's fine
    }
  };
  return [open, toggle] as const;
}

/** Pixel box as CSS custom properties (the stylesheet decides whether to use them). */
function boxVars(prefix: string, b: { left: number; top: number; width: number; height: number }): CSSProperties {
  return {
    [`--${prefix}-l`]: `${b.left}px`,
    [`--${prefix}-t`]: `${b.top}px`,
    [`--${prefix}-w`]: `${b.width}px`,
    [`--${prefix}-h`]: `${b.height}px`,
  } as CSSProperties;
}

export function Table({ net }: { net: NetState }) {
  useLang();
  useContent();
  const { room, view, request, waiting, log } = net;
  const [selState, setSelState] = useState<{ id: number | null; sel: Selection }>({ id: null, sel: EMPTY });
  const [showLog, toggleLog] = useLogOpen();
  const [hideResultFor, setHideResultFor] = useState<number | null>(null);
  const [arenaRef, arena] = useSize<HTMLDivElement>();
  const [handRef, hand] = useSize<HTMLDivElement>();
  if (!room || !view) return null;

  const req = request?.req ?? null;
  const sel = request && selState.id === request.id ? selState.sel : EMPTY;
  const setSel = (s: Selection) => setSelState({ id: request?.id ?? null, sel: s });
  const nameOf = (seat: number) => memberName(room.members[seat], seat);
  const name = (seat: number | null | undefined) => (seat == null ? "?" : seat === view.you ? t("name.you") : nameOf(seat));

  const n = view.players.length;
  const opponents = opponentOrder(view.you, n);
  // Null until measured, and when the table is too small for the seats-in-a-row layout:
  // then the stylesheet stacks the seats (as on phones) and the table scrolls inside.
  const layout = arena.width > 0 ? tableLayout(opponents.length, arena.width, arena.height) : null;
  const fan = handFan(view.hand.length, hand.width);
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

  // As many of the latest plays as fit beside the piles (one row; older ones are in the log).
  const playRoom = layout ? Math.max(1, Math.floor((layout.center.width - 210) / 72)) : 4;
  const plays = recentPlays(log).slice(-playRoom);
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
        <Button shape="pill" className="log-toggle" onClick={toggleLog} aria-expanded={showLog}>
          {showLog ? t("table.hideLog") : t("table.log")}
        </Button>
        <Button shape="pill" variant="ghost" onClick={() => window.confirm(t("table.leaveConfirm")) && leave()}>
          {t("table.leave")}
        </Button>
      </header>

      <div className={`table-main ${showLog ? "log-open" : ""}`}>
        <div
          ref={arenaRef}
          className={`arena ${layout ? "placed" : "stacked"}`}
          style={layout ? ({ "--plaque-h": `${layout.plaqueHeight}px` } as CSSProperties) : undefined}
        >
          {opponents.map((seat, i) => (
            // The slot does the positioning, so the seat's own transforms (press, shake) can't move it.
            <div key={seat} className="seat-slot" style={layout ? boxVars("seat", layout.seats[i]) : undefined}>
              <Plaque player={view.players[seat]} name={nameOf(seat)} {...seatProps(seat)} />
            </div>
          ))}
          <div className="center" style={layout ? boxVars("center", layout.center) : undefined}>
            <div className="piles">
              <span className="pile">
                <CardBack size="sm" label={t("table.drawPile")} />
                <span>{t("table.deck", { n: view.draw_pile })}</span>
              </span>
              <span className="pile">
                <span className="pile-empty" aria-hidden="true" />
                <span>{t("table.discard", { n: view.discard_pile })}</span>
              </span>
            </div>
            <div className="plays">
              {plays.length === 0 && (
                <span className="turn-note">
                  {view.current === view.you ? t("table.yourTurn") : t("table.theirTurn", { name: name(view.current) })}
                </span>
              )}
              {plays.map((p) => (
                <div key={p.key} className="play-slot">
                  <Card card={p.card} size="sm" />
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
        <div className="dock-self">
          <Plaque player={me} name={nameOf(view.you)} variant="self" isYou {...seatProps(view.you)} offline={false} range={view.attack_range} />
        </div>
        <div className="dock-main">
          <ActionBar request={request} view={view} sel={sel} setSel={setSel} name={name} waitingText={waitingText} />
          <div ref={handRef} className="hand" aria-label={t("table.hand")}>
            {view.hand.length === 0 && <span className="turn-note">{t("table.noCards")}</span>}
            {view.hand.map((c, i) => {
              const clickable = cardClickable(req, sel, c.id);
              const selected = sel.cards.includes(c.id) || (sel.mode?.type === "card" && sel.mode.cardId === c.id);
              const tilt = fan.tilt(i);
              return (
                // The slot fans the card (overlap + tilt); the card's own lift stays separate.
                <span
                  key={c.id}
                  className={`hand-slot ${selected ? "is-selected" : ""}`}
                  style={{ marginLeft: i === 0 ? 0 : fan.step - 88, transform: `translateY(${Math.abs(tilt) * 0.6}px) rotate(${tilt}deg)` }}
                >
                  <Card
                    card={c}
                    clickable={clickable}
                    selected={selected}
                    dim={!!req && !clickable && req.kind !== "choose_hero"}
                    onClick={() => req && setSel(clickCard(req, sel, c.id))}
                  />
                </span>
              );
            })}
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
