import { useEffect } from "react";
import { cardInfo, cardText, cardTitle, reasonTitle, sealChar, skillTitle } from "../content";
import { play } from "../sound";
import { serverText, t, tMaybe } from "../i18n";
import { answer } from "../net";
import { EMPTY, buildAnswer, chooseSkill, complete, hint, type Selection } from "../selection";
import type { ActiveRequest, Card, GameRequest, GameView, RespondReq } from "../types";
import { TimerRing } from "../ui/Bits";
import { Button, SealButton } from "../ui/Button";
import { Card as CardFace } from "../ui/Card";
import s from "./ActionBar.module.css";
import { KEY } from "./shortcuts";

type NameFn = (seat: number | null | undefined) => string;

export function respondText(r: RespondReq, name: NameFn, you: number): string {
  const by = name(r.about);
  const ctx = r.context as {
    card?: Card; target?: number; cancelled?: boolean; victim?: number; source?: number; need?: number; got?: number;
  };
  const nth = (ctx.got ?? 0) + 1; // against someone who demands two: which one this is
  switch (`${r.card_name}:${r.reason}`) {
    case "dodge:strike":
      return ctx.need === 2 ? t("resp.dodgeStrikeDouble", { name: by, n: nth }) : t("resp.dodgeStrike", { name: by });
    case "dodge:arrows":
      return t("resp.dodgeArrows", { name: by });
    case "dodge:shield_wall":
    case "dodge:guard_the_throne":
      return t("resp.dodgeForLord", { name: by, skill: reasonTitle(r.reason) });
    case "strike:call_to_arms":
      return t("resp.strikeForLord", { name: by, skill: reasonTitle(r.reason) });
    case "strike:duel":
      return ctx.need === 2 ? t("resp.strikeDuelDouble", { name: by, n: nth }) : t("resp.strikeDuel", { name: by });
    case "strike:barbarians":
      return t("resp.strikeBarbarians", { name: by });
    case "strike:borrowed_sword":
      return t("resp.strikeBorrowed", { name: by, source: name(ctx.source) });
    case "strike:dragon_glaive":
      return t("resp.strikeGlaive", { name: by });
    case "peach:save":
      return r.about === you ? t("resp.peachSelf") : t("resp.peachOther", { name: by });
  }
  if (r.card_name === "nullify" && ctx.card) {
    // "on you", not "on You": the target is the object of the sentence here.
    const target = ctx.target === you ? t("name.youObject") : name(ctx.target);
    const params = { card: cardText(ctx.card), name: target };
    return ctx.cancelled ? t("resp.unNullify", params) : t("resp.nullify", params);
  }
  return t("resp.generic", { card: cardTitle(r.card_name), reason: reasonTitle(r.reason) });
}

function title(r: GameRequest, name: NameFn, you: number): string {
  switch (r.kind) {
    case "play":
      return t("act.playPhase");
    case "respond":
      return respondText(r, name, you);
    case "discard": {
      if (r.reason === "discard_phase") return t("act.discardPhase", { n: r.count });
      const suit = String(r.context?.suit ?? "");
      return (
        tMaybe(`pick.${r.reason}`, { name: name(r.about), suit: tMaybe(`opt.${suit}`) ?? suit, n: r.count }) ??
        t("act.discardFor", { reason: reasonTitle(r.reason), n: r.count })
      );
    }
    case "choose_card":
      if (r.reason === "fire_attack" && r.context?.step) {
        const ctx = r.context as { step: string; source?: number; target?: number; suit?: string };
        return ctx.step === "show"
          ? t("fireAttack.show", { name: name(ctx.source) })
          : t("fireAttack.discard", { name: name(ctx.target), suit: tMaybe(`opt.${ctx.suit}`) ?? String(ctx.suit) });
      }
      return r.about != null && r.about !== you
        ? t("act.chooseTheirCard", { reason: reasonTitle(r.reason), name: name(r.about) })
        : t("act.chooseCard", { reason: reasonTitle(r.reason) });
    case "confirm":
      if ((r.context as { again?: boolean }).again) return t("act.again", { reason: reasonTitle(r.reason) });
      return tMaybe(`confirm.${r.reason}`) ?? t("act.useConfirm", { reason: reasonTitle(r.reason) });
    case "choose_player":
      return (
        tMaybe(`choose.${r.reason}`, { name: name(r.about) }) ??
        (r.about != null
          ? t("act.choosePlayerFor", { reason: reasonTitle(r.reason), name: name(r.about) })
          : t("act.choosePlayer", { reason: reasonTitle(r.reason) }))
      );
    case "choose_option":
      return r.about != null
        ? t("act.chooseOptionFrom", { reason: reasonTitle(r.reason), name: name(r.about) })
        : t("act.chooseOption", { reason: reasonTitle(r.reason) });
    case "choose_hero":
      return t("act.chooseHero");
    case "arrange":
      return t("arrange.title", { reason: reasonTitle(r.reason) });
  }
}

/** The judgment a skill is about to change (Omen re-judges, Bend Fate replaces the card). */
function judgmentHint(r: GameRequest, name: NameFn): string | null {
  if ((r.kind !== "confirm" && r.kind !== "choose_card") || !r.context || !("judge_reason" in r.context)) return null;
  const ctx = r.context as { judge_reason: string; card: Card; would_hit: boolean; seat?: number };
  const params = {
    reason: reasonTitle(ctx.judge_reason),
    name: name(ctx.seat ?? r.about),
    card: cardText(ctx.card),
    result: t(ctx.would_hit ? "act.hit" : "act.miss"),
  };
  return t(r.kind === "confirm" ? "act.omen" : "act.bendFate", params);
}

/** Seal character for a skill or a converting card (Serpent Spear is a card, Burning Fleet a skill). */
const sealFor = (id: string) => (cardInfo(id) ? sealChar("card", id, "last") : sealChar("skill", id, "last"));

interface Props {
  request: ActiveRequest | null;
  view: GameView;
  sel: Selection;
  setSel: (s: Selection) => void;
  name: NameFn;
  waitingText: string;
}

/** Woodblock ticks for the last five seconds of your decision. */
function useCountdownTicks(deadline: number | null) {
  useEffect(() => {
    if (deadline == null) return;
    let last = -1;
    const id = window.setInterval(() => {
      const secs = Math.ceil((deadline - Date.now()) / 1000);
      if (secs !== last && secs >= 1 && secs <= 5) play(secs === 1 ? "tickLast" : "tick");
      last = secs;
    }, 200);
    return () => window.clearInterval(id);
  }, [deadline]);
}

/** The prompt banner: what the game is asking you, a timer ring, and your options. */
export function ActionBar({ request, view, sel, setSel, name, waitingText }: Props) {
  useCountdownTicks(request?.deadline ?? null);
  if (!request) {
    return (
      <div className={`${s.bar} ${s.idle} action-bar idle`} role="status">
        <span className={s.waiting}>{waitingText}</span>
      </div>
    );
  }
  const r = request.req;
  const shown = r.kind === "choose_card" ? r.shown ?? [] : [];
  const findCard = (id: number): Card | undefined =>
    [...shown, ...view.hand, ...view.processing, ...view.players.flatMap((p) => [...p.equips, ...p.judge])].find((c) => c.id === id);
  const judgment = judgmentHint(r, name);
  const submit = () => answer(buildAnswer(r, sel));
  const ready = complete(r, sel);
  const skillOn = (skill: string) => sel.mode?.type === "skill" && sel.mode.skill === skill;
  // A recastable card (Iron Chain) picked with no targets is recast: discard it, draw 1.
  const picked = sel.mode?.type === "card" ? view.hand.find((c) => sel.mode?.type === "card" && c.id === sel.mode.cardId) : undefined;
  const recastable = !!picked && !!cardInfo(picked.name)?.recast;
  const recast = recastable && sel.targets.length === 0;
  const hintText =
    r.kind === "play" || r.kind === "respond" || r.kind === "discard" || r.kind === "choose_player"
      ? [hint(r, sel) || (r.kind === "respond" ? t("act.hintRespond") : ""), recastable ? t("act.recastHint") : ""]
          .filter(Boolean)
          .join(" · ")
      : "";

  return (
    <div className={`${s.bar} ${s.active} action-bar active`} role="group" aria-label={title(r, name, view.you)}>
      <TimerRing deadline={request.deadline} total={request.total} />
      <div className={s.text}>
        <div className={`${s.title} action-title`}>{title(r, name, view.you)}</div>
        {r.error && <div className={s.error}>{serverText(r.error)}</div>}
        {judgment && <div className={s.hint}>{judgment}</div>}
        {hintText && <div className={s.hint}>{hintText}</div>}
      </div>

      <div className={`${s.buttons} action-buttons`}>
        {r.kind === "play" && (
          <>
            {r.conversions.map((c) => (
              <SealButton
                key={c.skill}
                char={sealFor(c.skill)}
                label={t("act.convert", { skill: reasonTitle(c.skill), card: cardTitle(c.as_name) })}
                active={skillOn(c.skill)}
                onClick={() => setSel(chooseSkill(sel, c.skill))}
              />
            ))}
            {r.skills.map((sk) => (
              <SealButton
                key={sk.skill}
                char={sealFor(sk.skill)}
                label={skillTitle(sk.skill)}
                active={skillOn(sk.skill)}
                onClick={() => setSel(chooseSkill(sel, sk.skill))}
              />
            ))}
            {sel.mode && (
              <>
                <Button variant="primary" disabled={!ready} onClick={submit} shortcut={KEY.main}>
                  {recast ? t("act.recast") : t("act.use")}
                </Button>
                <Button onClick={() => setSel(EMPTY)} shortcut={KEY.back}>
                  {t("act.cancel")}
                </Button>
              </>
            )}
            <Button variant="ghost" className="end-phase" onClick={() => answer(null)} shortcut={KEY.end}>
              {t("act.endPhase")}
            </Button>
          </>
        )}

        {r.kind === "respond" && (
          <>
            {r.conversions.map((c) => (
              <SealButton
                key={c.skill}
                char={sealFor(c.skill)}
                label={t("act.useSkill", { skill: reasonTitle(c.skill) })}
                active={skillOn(c.skill)}
                onClick={() => setSel(chooseSkill(sel, c.skill))}
              />
            ))}
            <Button variant="primary" disabled={!ready} onClick={submit} shortcut={KEY.main}>
              {t("act.play")}
            </Button>
            <Button onClick={() => answer(null)} shortcut={KEY.back}>
              {t("act.dontPlay")}
            </Button>
          </>
        )}

        {(r.kind === "discard" || r.kind === "choose_player") && (
          <Button variant="primary" disabled={!ready} onClick={submit} shortcut={KEY.main}>
            {(r.kind === "discard" && tMaybe(`pickBtn.${r.reason}`)) || t("act.confirm")}
          </Button>
        )}
        {r.kind === "choose_player" && r.optional && (
          <Button onClick={() => answer(null)} shortcut={KEY.back}>
            {tMaybe(`skip.${r.reason}`) ?? t("act.none")}
          </Button>
        )}

        {r.kind === "confirm" && (
          <>
            <Button variant="primary" onClick={() => answer(true)} shortcut={KEY.main}>
              {t("act.yes")}
            </Button>
            <Button onClick={() => answer(false)} shortcut={KEY.back}>
              {t("act.no")}
            </Button>
          </>
        )}

        {r.kind === "choose_option" &&
          r.choices.map((c, i) => (
            <Button key={c} variant={i === 0 ? "primary" : "secondary"} onClick={() => answer(c)} shortcut={i === 0 ? KEY.main : undefined}>
              {tMaybe(`opt.${c}`) ?? c}
            </Button>
          ))}

        {r.kind === "choose_card" && (
          <>
            <div className={`${s.choices} choice-cards`}>
              {r.options.map((id) => {
                const c = findCard(id);
                return c ? <CardFace key={id} card={c} size="sm" clickable onClick={() => answer(id)} /> : null;
              })}
            </div>
            {r.hidden_count > 0 && <Button onClick={() => answer("hand")}>{t("act.randomHand", { n: r.hidden_count })}</Button>}
            {r.optional && (
              <Button variant="ghost" onClick={() => answer(null)} shortcut={KEY.back}>
                {t("act.none")}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
