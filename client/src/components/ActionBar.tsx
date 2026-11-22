import { useEffect, useState } from "react";
import { cardText, cardTitle, titleCase } from "../content";
import { answer } from "../net";
import { EMPTY, buildAnswer, chooseSkill, complete, hint, type Selection } from "../selection";
import type { ActiveRequest, Card, GameRequest, GameView, RespondReq } from "../types";
import { CardView } from "./CardView";

type NameFn = (seat: number | null | undefined) => string;

const OPTION_LABEL: Record<string, string> = {
  let_draw: "Let them draw 1 card",
  discard: "Discard a hand card",
  give_card: "Give them a hand card",
  take_damage: "Take 1 damage",
};

const CONFIRM_TEXT: Record<string, string> = {
  eight_trigrams: "Use Eight Trigrams? Judge: a red card counts as a Dodge.",
  twin_swords: "Use Twin Swords? They discard a card or you draw 1.",
  frost_blade: "Use Frost Blade? Prevent the damage and discard 2 of their cards instead.",
  stone_axe: "Use Stone Axe? Discard 2 cards to make the Strike hit anyway.",
  shield_wall: "Use Shield Wall? Ask your Wei allies to play a Dodge for you.",
};

export function respondText(r: RespondReq, name: NameFn, you: number): string {
  const by = name(r.about);
  const ctx = r.context as { card?: Card; target?: number; cancelled?: boolean; victim?: number; source?: number };
  switch (`${r.card_name}:${r.reason}`) {
    case "dodge:strike":
      return `${by} attacks you with a Strike. Play a Dodge?`;
    case "dodge:arrows":
      return `Arrow Barrage from ${by}. Play a Dodge or take 1 damage.`;
    case "dodge:shield_wall":
      return `Your Lord ${by} needs a Dodge (Shield Wall). Play one for them?`;
    case "strike:duel":
      return `Duel with ${by}: play a Strike, or take 1 damage.`;
    case "strike:barbarians":
      return `Barbarian Invasion from ${by}. Play a Strike or take 1 damage.`;
    case "strike:borrowed_sword":
      return `Borrowed Sword: use a Strike on ${by}, or hand your weapon to ${name(ctx.source)}.`;
    case "strike:allure":
      return `Allure: use a Strike on ${by}, or ${name(ctx.source)} takes one of your cards.`;
    case "strike:dragon_glaive":
      return `Dragon Glaive: Strike ${by} again?`;
    case "peach:save":
      return r.about === you ? "You are dying! Play a Peach to survive." : `${by} is dying. Save them with a Peach?`;
  }
  if (r.card_name === "nullify" && ctx.card) {
    const what = `${cardText(ctx.card)} on ${name(ctx.target)}`;
    return ctx.cancelled ? `${what} is cancelled. Nullify the Nullify to put it back on?` : `Nullify ${what}?`;
  }
  return `Play a ${cardTitle(r.card_name)}? (${titleCase(r.reason)})`;
}

function title(r: GameRequest, name: NameFn, you: number): string {
  switch (r.kind) {
    case "play":
      return "Your turn: play phase";
    case "respond":
      return respondText(r, name, you);
    case "discard":
      return r.reason === "discard_phase"
        ? `Discard ${r.count} card${r.count > 1 ? "s" : ""} down to your hand limit.`
        : `${titleCase(r.reason)}: discard ${r.count} card${r.count > 1 ? "s" : ""}.`;
    case "choose_card":
      return r.about != null && r.about !== you
        ? `${titleCase(r.reason)}: choose one of ${name(r.about)}'s cards.`
        : `${titleCase(r.reason)}: choose a card.`;
    case "confirm":
      return CONFIRM_TEXT[r.reason] ?? `Use ${titleCase(r.reason)}?`;
    case "choose_player":
      return `${titleCase(r.reason)}: choose a player${r.about != null ? ` (for ${name(r.about)})` : ""}. Click them on the table.`;
    case "choose_option":
      return `${titleCase(r.reason)}${r.about != null ? ` from ${name(r.about)}` : ""}: choose one.`;
    case "choose_hero":
      return "Choose your hero.";
  }
}

function Timer({ request }: { request: ActiveRequest }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, request.deadline - now);
  const frac = request.total > 0 ? left / request.total : 0;
  return (
    <div className={`timer ${frac < 0.25 ? "low" : ""}`} aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <div className="timer-fill" style={{ width: `${frac * 100}%` }} />
      <span className="timer-text">{Math.ceil(left / 1000)}s</span>
    </div>
  );
}

interface Props {
  request: ActiveRequest | null;
  view: GameView;
  sel: Selection;
  setSel: (s: Selection) => void;
  name: NameFn;
  waitingText: string;
}

export function ActionBar({ request, view, sel, setSel, name, waitingText }: Props) {
  if (!request) {
    return (
      <div className="action-bar idle">
        <span className="muted">{waitingText}</span>
      </div>
    );
  }
  const r = request.req;
  const findCard = (id: number): Card | undefined =>
    [...view.hand, ...view.processing, ...view.players.flatMap((p) => [...p.equips, ...p.judge])].find((c) => c.id === id);
  const submit = () => answer(buildAnswer(r, sel));
  const ready = complete(r, sel);

  return (
    <div className="action-bar active">
      <Timer request={request} />
      <div className="action-title">{title(r, name, view.you)}</div>
      {r.error && <div className="error-line">{r.error}</div>}

      {r.kind === "confirm" && r.reason === "omen" && (
        <div className="muted small">
          Judgment {String((r.context as { judge_reason?: string }).judge_reason ?? "")} for {name(r.about)}:{" "}
          {cardText((r.context as { card?: Card }).card)} would {(r.context as { would_hit?: boolean }).would_hit ? "hit" : "miss"}. Re-judge it?
        </div>
      )}

      {(r.kind === "play" || r.kind === "respond" || r.kind === "discard" || r.kind === "choose_player") && (
        <div className="muted small">{hint(r, sel) || (r.kind === "respond" ? "Pick the card in your hand, then Play." : "")}</div>
      )}

      <div className="action-buttons">
        {r.kind === "play" && (
          <>
            {r.conversions.map((c) => (
              <button key={c.skill} className={sel.mode?.type === "skill" && sel.mode.skill === c.skill ? "primary" : ""} onClick={() => setSel(chooseSkill(sel, c.skill))}>
                {titleCase(c.skill)} → {cardTitle(c.as_name)}
              </button>
            ))}
            {r.skills.map((s) => (
              <button key={s.skill} className={sel.mode?.type === "skill" && sel.mode.skill === s.skill ? "primary" : ""} onClick={() => setSel(chooseSkill(sel, s.skill))}>
                {titleCase(s.skill)}
              </button>
            ))}
            {sel.mode && (
              <>
                <button className="primary" disabled={!ready} onClick={submit}>
                  Use
                </button>
                <button onClick={() => setSel(EMPTY)}>Cancel</button>
              </>
            )}
            <button className="end-phase" onClick={() => answer(null)}>
              End play phase
            </button>
          </>
        )}

        {r.kind === "respond" && (
          <>
            {r.conversions.map((c) => (
              <button key={c.skill} className={sel.mode?.type === "skill" && sel.mode.skill === c.skill ? "primary" : ""} onClick={() => setSel(chooseSkill(sel, c.skill))}>
                Use {titleCase(c.skill)}
              </button>
            ))}
            <button className="primary" disabled={!ready} onClick={submit}>
              Play
            </button>
            <button onClick={() => answer(null)}>Don't play</button>
          </>
        )}

        {(r.kind === "discard" || r.kind === "choose_player") && (
          <button className="primary" disabled={!ready} onClick={submit}>
            Confirm
          </button>
        )}

        {r.kind === "confirm" && (
          <>
            <button className="primary" onClick={() => answer(true)}>
              Yes
            </button>
            <button onClick={() => answer(false)}>No</button>
          </>
        )}

        {r.kind === "choose_option" &&
          r.choices.map((c) => (
            <button key={c} onClick={() => answer(c)}>
              {OPTION_LABEL[c] ?? titleCase(c)}
            </button>
          ))}

        {r.kind === "choose_card" && (
          <>
            <div className="choice-cards">
              {r.options.map((id) => {
                const c = findCard(id);
                return c ? <CardView key={id} card={c} size="sm" clickable onClick={() => answer(id)} /> : null;
              })}
            </div>
            {r.hidden_count > 0 && <button onClick={() => answer("hand")}>A random hand card ({r.hidden_count})</button>}
            {r.optional && <button onClick={() => answer(null)}>None</button>}
          </>
        )}
      </div>
    </div>
  );
}
