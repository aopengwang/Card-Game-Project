import { cardInfo, cardText, cardTitle, reasonTitle, sealChar, skillTitle } from "../content";
import { serverText, t, tMaybe } from "../i18n";
import { answer } from "../net";
import { EMPTY, buildAnswer, chooseSkill, complete, hint, type Selection } from "../selection";
import type { ActiveRequest, Card, GameRequest, GameView, RespondReq } from "../types";
import { TimerRing } from "../ui/Bits";
import { Button, SealButton } from "../ui/Button";
import { Card as CardFace } from "../ui/Card";
import s from "./ActionBar.module.css";

type NameFn = (seat: number | null | undefined) => string;

export function respondText(r: RespondReq, name: NameFn, you: number): string {
  const by = name(r.about);
  const ctx = r.context as { card?: Card; target?: number; cancelled?: boolean; victim?: number; source?: number };
  switch (`${r.card_name}:${r.reason}`) {
    case "dodge:strike":
      return t("resp.dodgeStrike", { name: by });
    case "dodge:arrows":
      return t("resp.dodgeArrows", { name: by });
    case "dodge:shield_wall":
      return t("resp.dodgeShieldWall", { name: by });
    case "strike:duel":
      return t("resp.strikeDuel", { name: by });
    case "strike:barbarians":
      return t("resp.strikeBarbarians", { name: by });
    case "strike:borrowed_sword":
      return t("resp.strikeBorrowed", { name: by, source: name(ctx.source) });
    case "strike:allure":
      return t("resp.strikeAllure", { name: by, source: name(ctx.source) });
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
    case "discard":
      return r.reason === "discard_phase"
        ? t("act.discardPhase", { n: r.count })
        : t("act.discardFor", { reason: reasonTitle(r.reason), n: r.count });
    case "choose_card":
      return r.about != null && r.about !== you
        ? t("act.chooseTheirCard", { reason: reasonTitle(r.reason), name: name(r.about) })
        : t("act.chooseCard", { reason: reasonTitle(r.reason) });
    case "confirm":
      return tMaybe(`confirm.${r.reason}`) ?? t("act.useConfirm", { reason: reasonTitle(r.reason) });
    case "choose_player":
      return r.about != null
        ? t("act.choosePlayerFor", { reason: reasonTitle(r.reason), name: name(r.about) })
        : t("act.choosePlayer", { reason: reasonTitle(r.reason) });
    case "choose_option":
      return r.about != null
        ? t("act.chooseOptionFrom", { reason: reasonTitle(r.reason), name: name(r.about) })
        : t("act.chooseOption", { reason: reasonTitle(r.reason) });
    case "choose_hero":
      return t("act.chooseHero");
  }
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

/** The prompt banner: what the game is asking you, a timer ring, and your options. */
export function ActionBar({ request, view, sel, setSel, name, waitingText }: Props) {
  if (!request) {
    return (
      <div className={`${s.bar} ${s.idle} action-bar idle`} role="status">
        <span className={s.waiting}>{waitingText}</span>
      </div>
    );
  }
  const r = request.req;
  const findCard = (id: number): Card | undefined =>
    [...view.hand, ...view.processing, ...view.players.flatMap((p) => [...p.equips, ...p.judge])].find((c) => c.id === id);
  const submit = () => answer(buildAnswer(r, sel));
  const ready = complete(r, sel);
  const skillOn = (skill: string) => sel.mode?.type === "skill" && sel.mode.skill === skill;
  const hintText =
    r.kind === "play" || r.kind === "respond" || r.kind === "discard" || r.kind === "choose_player"
      ? hint(r, sel) || (r.kind === "respond" ? t("act.hintRespond") : "")
      : "";

  return (
    <div className={`${s.bar} ${s.active} action-bar active`} role="group" aria-label={title(r, name, view.you)}>
      <TimerRing deadline={request.deadline} total={request.total} />
      <div className={s.text}>
        <div className={`${s.title} action-title`}>{title(r, name, view.you)}</div>
        {r.error && <div className={s.error}>{serverText(r.error)}</div>}
        {r.kind === "confirm" && r.reason === "omen" && (
          <div className={s.hint}>
            {t("act.omen", {
              reason: reasonTitle(String((r.context as { judge_reason?: string }).judge_reason ?? "")),
              name: name(r.about),
              card: cardText((r.context as { card?: Card }).card),
              result: t((r.context as { would_hit?: boolean }).would_hit ? "act.hit" : "act.miss"),
            })}
          </div>
        )}
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
                <Button variant="primary" disabled={!ready} onClick={submit}>
                  {t("act.use")}
                </Button>
                <Button onClick={() => setSel(EMPTY)}>{t("act.cancel")}</Button>
              </>
            )}
            <Button variant="ghost" className="end-phase" onClick={() => answer(null)}>
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
            <Button variant="primary" disabled={!ready} onClick={submit}>
              {t("act.play")}
            </Button>
            <Button onClick={() => answer(null)}>{t("act.dontPlay")}</Button>
          </>
        )}

        {(r.kind === "discard" || r.kind === "choose_player") && (
          <Button variant="primary" disabled={!ready} onClick={submit}>
            {t("act.confirm")}
          </Button>
        )}

        {r.kind === "confirm" && (
          <>
            <Button variant="primary" onClick={() => answer(true)}>
              {t("act.yes")}
            </Button>
            <Button onClick={() => answer(false)}>{t("act.no")}</Button>
          </>
        )}

        {r.kind === "choose_option" &&
          r.choices.map((c, i) => (
            <Button key={c} variant={i === 0 ? "primary" : "secondary"} onClick={() => answer(c)}>
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
            {r.optional && <Button variant="ghost" onClick={() => answer(null)}>{t("act.none")}</Button>}
          </>
        )}
      </div>
    </div>
  );
}
