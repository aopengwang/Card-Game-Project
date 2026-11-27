import { useEffect, useRef, useState, type CSSProperties } from "react";
import { heroName, useContent } from "../content";
import { recentPlays } from "../describe";
import { memberName, t, tMaybe, useLang } from "../i18n";
import { handFan, opponentOrder, sizeTier, tableLayout } from "../layout";
import { leave, type NetState } from "../net";
import { EMPTY, cardClickable, clickCard, clickSeat, seatClickable, type Selection } from "../selection";
import { Button } from "../ui/Button";
import { Card, CardBack } from "../ui/Card";
import { Plaque } from "../ui/Plaque";
import { useSize, useWindowSize } from "../useSize";
import { setTableMode, useUiScale } from "../uiScale";
import { play } from "../sound";
import { MuteButton, SettingsButton } from "./Settings";
import { ActionBar } from "./ActionBar";
import { Arrange } from "./Arrange";
import { ChatBox, useBubbles } from "./Chat";
import { EmoteButton, EmotePop, useEmotePops } from "./Emotes";
import { Effects } from "./Effects";
import { useShortcuts } from "./shortcuts";
import { TestPanel } from "./TestPanel";
import { LangToggle } from "./LangToggle";
import { GameOver, HeroPick, LogPanel } from "./Overlays";

const LOG_KEY = "sgs.logOpen";
const TAB_KEY = "sgs.sideTab";

/** A small setting remembered per browser (nothing breaks if storage is blocked). */
function useRemembered<T extends string>(key: string, initial: () => T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved != null) return saved as T;
    } catch {
      // storage unavailable (private mode): the default
    }
    return initial();
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // not remembered, that's fine
    }
  };
  return [value, set];
}

/** Side panel open/closed. Default: open where there's room for it. */
function useLogOpen() {
  const [open, setOpen] = useRemembered<"1" | "0">(LOG_KEY, () => (window.innerWidth >= 1280 ? "1" : "0"));
  return [open === "1", (v: boolean) => setOpen(v ? "1" : "0")] as const;
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
  const [showLog, setShowLog] = useLogOpen();
  const [tab, setTab] = useRemembered<"log" | "chat">(TAB_KEY, () => "log");
  const [hideResultFor, setHideResultFor] = useState<number | null>(null);
  const [arenaRef, arena] = useSize<HTMLDivElement>();
  const [handRef, hand] = useSize<HTMLDivElement>();
  const win = useWindowSize();
  const scale = useUiScale(); // the window in the app's own (zoomed) pixels picks card sizes
  const tier = sizeTier(win.width / scale, win.height / scale);
  useShortcuts();
  // The table is exactly one window tall. When the interface is shrunk to fit (a phone on
  // its side), browsers still measure the page at its unshrunk height and let it scroll
  // into empty space below the table: the stylesheet stops that while we're here.
  useEffect(() => {
    document.documentElement.classList.add("on-table");
    setTableMode(true);
    return () => {
      document.documentElement.classList.remove("on-table");
      setTableMode(false);
    };
  }, []);

  // Chat: unread count while it's out of sight, bubbles over the speakers, T to type.
  const chat = net.chat;
  const lastChat = chat.length ? chat[chat.length - 1].id : 0;
  const [seenChat, setSeenChat] = useState(lastChat);
  const chatVisible = showLog && tab === "chat";
  useEffect(() => {
    if (chatVisible) setSeenChat(lastChat);
  }, [chatVisible, lastChat]);
  const unread = chatVisible ? 0 : chat.filter((m) => m.id > seenChat && m.seat !== view?.you).length;
  const bubbles = useBubbles(chat);
  const pops = useEmotePops(net.emotes);
  const chatInput = useRef<HTMLInputElement>(null);
  const openChat = useRef(() => {});
  openChat.current = () => {
    setShowLog(true);
    setTab("chat");
    requestAnimationFrame(() => chatInput.current?.focus());
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "t" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable=true]") || document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      openChat.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!room || !view) return null;

  const req = request?.req ?? null;
  const sel = request && selState.id === request.id ? selState.sel : EMPTY;
  const setSel = (s: Selection) => setSelState({ id: request?.id ?? null, sel: s });
  const nameOf = (seat: number) => memberName(room.members[seat], seat);
  // Test room: answering for a bot. The table stays yours; the dock shows the bot's hand,
  // and the prompt speaks to the bot ("you" = the bot).
  const actor = request?.asView ?? null;
  const acting = actor ? { ...view, you: actor.you, hand: actor.hand, attack_range: actor.attack_range } : view;
  const nameFor = (you: number) => (seat: number | null | undefined) => (seat == null ? "?" : seat === you ? t("name.you") : nameOf(seat));
  const name = nameFor(view.you);
  const actName = nameFor(acting.you); // the prompt you're answering
  const handCards = acting.hand;

  const n = view.players.length;
  const opponents = opponentOrder(view.you, n);
  // Null until measured, and when the table is too small for the seats-in-a-row layout:
  // then the stylesheet stacks the seats (as on phones) and the table scrolls inside.
  // Portrait phones always stack, at any interface size (the phone styles expect it; a
  // shrunk interface would otherwise measure wide enough for the desktop layout).
  const phone = win.width <= 760;
  const layout = arena.width > 0 && !phone ? tableLayout(opponents.length, arena.width, arena.height, tier.centerH) : null;
  const fan = handFan(handCards.length, hand.width, tier.handW);
  /** Which side of the table a seat touches (emotes and chat bubbles there turn inward). */
  const edgeOf = (i: number): "left" | "right" | null => {
    const b = layout?.seats[i];
    if (!b) return null;
    if (b.left + b.width > arena.width - 40) return "right";
    return b.left < 40 ? "left" : null;
  };
  const me = view.players[view.you];
  const lordSeat = view.players.find((p) => p.role === "lord")?.seat;

  const seatProps = (seat: number) => ({
    clickable: seatClickable(req, sel, seat),
    selected: sel.targets.includes(seat),
    onClick: req ? () => setSel(clickSeat(req, sel, seat)) : undefined,
    isCurrent: view.current === seat && !view.result,
    isWaitedOn: (waiting?.seat === seat && !request) || actor?.you === seat,
    offline: !room.members[seat]?.connected,
  });
  // Your equipment as pickable cards, when a request can spend it (the bot's, when acting for one).
  const equipPick = req
    ? {
        clickable: (id: number) => cardClickable(req, sel, id),
        selected: (id: number) => sel.cards.includes(id),
        onClick: (id: number) => {
          play("select");
          setSel(clickCard(req, sel, id));
        },
      }
    : undefined;

  const waitingText = view.result
    ? t("table.over")
    : waiting?.seat != null
      ? t("table.waitingFor", { name: name(waiting.seat), what: tMaybe(`wait.${waiting.kind}`) ?? "" })
      : t("table.waitingOthers");

  // As many of the latest plays as fit beside the piles (one row; older ones are in the log).
  const playRoom = layout ? Math.max(1, Math.floor((layout.center.width - 210) / (tier.playW + 8))) : 4;
  const plays = recentPlays(log).slice(-playRoom);
  const resultKey = view.result ? log.length : null;

  return (
    <div
      className="table-screen"
      style={{ "--dock-h": `${tier.dockH}px`, "--hand-w": `${tier.handW}px`, "--hand-h": `${tier.handH}px` } as CSSProperties}
    >
      <header className="topbar">
        <span className="brand">{t("app.title")}</span>
        <span className="pill">{t("table.room", { code: room.code })}</span>
        <span className="pill">{t("table.turn", { n: view.turn })}</span>
        {view.phase && (
          <span className="pill">{t("table.phase", { name: name(view.current), phase: tMaybe(`phase.${view.phase}`) ?? view.phase })}</span>
        )}
        {net.conn !== "open" && <span className="pill warn">{t("conn.reconnecting")}</span>}
        <span className="spacer" />
        {room.sandbox && !view.result && <TestPanel room={room} view={view} name={name} />}
        <EmoteButton />
        <MuteButton />
        <SettingsButton />
        <LangToggle />
        <Button shape="pill" className="log-toggle" onClick={() => setShowLog(!showLog)} aria-expanded={showLog}>
          {showLog ? t("table.hideLog") : t("table.log")}
          {unread > 0 && (
            <span className="unread" aria-label={t("chat.unread", { n: unread })}>
              {unread}
            </span>
          )}
        </Button>
        <Button shape="pill" variant="ghost" onClick={() => window.confirm(t("table.leaveConfirm")) && leave()}>
          {t("table.leave")}
        </Button>
      </header>

      <div className={`table-main ${showLog ? "log-open" : ""}`}>
        <div
          ref={arenaRef}
          className={`arena ${layout ? "placed" : "stacked"}`}
        >
          {opponents.map((seat, i) => (
            // The slot does the positioning, so the seat's own transforms (press, shake) can't move it.
            <div key={seat} className="seat-slot" data-seat={seat} style={layout ? boxVars("seat", layout.seats[i]) : undefined}>
              <Plaque
                player={view.players[seat]}
                name={nameOf(seat)}
                {...seatProps(seat)}
                equipPick={actor?.you === seat ? equipPick : undefined}
              />
              {bubbles.get(seat) && (
                <span className={`chat-bubble ${edgeOf(i) ? `at-${edgeOf(i)}` : ""}`}>{bubbles.get(seat)!.text}</span>
              )}
              {pops.get(seat) && (
                <EmotePop
                  key={pops.get(seat)!.key}
                  event={pops.get(seat)!}
                  side={!layout ? "inside" : edgeOf(i) === "right" ? "left" : "right"}
                />
              )}
            </div>
          ))}
          <div className="center" style={layout ? boxVars("center", layout.center) : undefined}>
            <div className="piles">
              <span className="pile" data-pile="draw">
                <CardBack size="sm" label={t("table.drawPile")} />
                <span>{t("table.deck", { n: view.draw_pile })}</span>
              </span>
              <span className="pile" data-pile="discard">
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
                <div key={p.key} className="play-slot" data-play-key={p.key}>
                  <Card card={p.card} size={tier.playSize} />
                  <span className="play-by">{p.seat != null ? name(p.seat) : ""}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className={`log-panel ${showLog ? "open" : ""}`}>
          <div className="side-tabs" role="tablist" aria-label={t("table.sidePanel")}>
            <button type="button" role="tab" aria-selected={tab === "log"} onClick={() => setTab("log")}>
              {t("table.logTab")}
            </button>
            <button type="button" role="tab" aria-selected={tab === "chat"} className="chat-tab" onClick={() => setTab("chat")}>
              {t("chat.title")}
              {unread > 0 && <span className="unread">{unread}</span>}
            </button>
          </div>
          {tab === "log" ? (
            // Log lines are third-person sentences ("X draws 2"), so use real names there.
            <LogPanel log={log} name={(seat) => (seat == null ? "?" : nameOf(seat))} />
          ) : (
            <ChatBox messages={chat} you={view.you} inputRef={chatInput} className="side-chat" />
          )}
        </aside>
      </div>

      <footer className="dock">
        <div className="dock-self" data-seat={view.you}>
          {bubbles.get(view.you) && <span className="chat-bubble">{bubbles.get(view.you)!.text}</span>}
          {pops.get(view.you) && <EmotePop key={pops.get(view.you)!.key} event={pops.get(view.you)!} />}
          <Plaque
            player={me}
            name={nameOf(view.you)}
            variant="self"
            isYou
            {...seatProps(view.you)}
            offline={false}
            range={view.attack_range}
            equipPick={actor ? undefined : equipPick}
          />
        </div>
        <div className="dock-main">
          <ActionBar request={request} view={acting} sel={sel} setSel={setSel} name={actName} waitingText={waitingText} />
          <div
            ref={handRef}
            className={`hand ${actor ? "acting" : ""}`}
            aria-label={actor ? t("test.botHand", { name: nameOf(actor.you) }) : t("table.hand")}
          >
            {actor && (
              <span className="acting-tag">
                {t("test.actingAs", { name: nameOf(actor.you), hero: heroName(view.players[actor.you].hero) })}
              </span>
            )}
            {handCards.length === 0 && <span className="turn-note">{t("table.noCards")}</span>}
            {handCards.map((c, i) => {
              const clickable = cardClickable(req, sel, c.id);
              const selected = sel.cards.includes(c.id) || (sel.mode?.type === "card" && sel.mode.cardId === c.id);
              const tilt = fan.tilt(i);
              return (
                // The slot fans the card (overlap + tilt); the card's own lift stays separate.
                <span
                  key={c.id}
                  className={`hand-slot ${selected ? "is-selected" : ""}`}
                  style={{ marginLeft: i === 0 ? 0 : fan.step - tier.handW, transform: `translateY(${Math.abs(tilt) * 0.6}px) rotate(${tilt}deg)` }}
                >
                  <Card
                    card={c}
                    size={tier.name === "large" ? "lg" : "md"}
                    clickable={clickable}
                    selected={selected}
                    dim={!!req && !clickable && req.kind !== "choose_hero"}
                    onClick={() => {
                      if (!req) return;
                      play("select");
                      setSel(clickCard(req, sel, c.id));
                    }}
                  />
                </span>
              );
            })}
          </div>
        </div>
      </footer>

      <Effects log={log} you={view.you} aimFrom={acting.you} aim={sel.targets} playSize={tier.playSize} nameOf={nameOf} hand={view.hand} />
      {req?.kind === "choose_hero" && <HeroPick req={req} isLordPick={lordSeat === view.you} />}
      {req?.kind === "arrange" && <Arrange key={request!.id} req={req} />}
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
