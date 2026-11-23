import { useEffect, useState } from "react";
import { cardText, cardTitle, reasonTitle, skillTitle } from "../content";
import { serverText, t, tMaybe } from "../i18n";
import { answer } from "../net";
import { EMPTY, buildAnswer, chooseSkill, complete, hint, type Selection } from "../selection";
import type { ActiveRequest, Card, GameRequest, GameView, RespondReq } from "../types";
import { CardView } from "./CardView";

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
    const params = { card: cardText(ctx.card), name: name(ctx.target) };
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

function Timer({ request }: { request: ActiveRequest }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, request.deadline - now);
  const frac = request.total > 0 ? left / request.total : 0;
  const secs = Math.ceil(left / 1000);
  return (
    <div className={`timer ${frac < 0.25 ? "low" : ""}`} aria-label={t("act.secondsLeft", { n: secs })}>
      <div className="timer-fill" style={{ width: `${frac * 100}%` }} />
      <span className="timer-text">{secs}s</span>
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
  const skillOn = (skill: string) => sel.mode?.type === "skill" && sel.mode.skill === skill;

  return (
    <div className="action-bar active">
      <Timer request={request} />
      <div className="action-title">{title(r, name, view.you)}</div>
      {r.error && <div className="error-line">{serverText(r.error)}</div>}

      {r.kind === "confirm" && r.reason === "omen" && (
        <div className="muted small">
          {t("act.omen", {
            reason: reasonTitle(String((r.context as { judge_reason?: string }).judge_reason ?? "")),
            name: name(r.about),
            card: cardText((r.context as { card?: Card }).card),
            result: t((r.context as { would_hit?: boolean }).would_hit ? "act.hit" : "act.miss"),
          })}
        </div>
      )}

      {(r.kind === "play" || r.kind === "respond" || r.kind === "discard" || r.kind === "choose_player") && (
        <div className="muted small">{hint(r, sel) || (r.kind === "respond" ? t("act.hintRespond") : "")}</div>
      )}

      <div className="action-buttons">
        {r.kind === "play" && (
          <>
            {r.conversions.map((c) => (
              <button key={c.skill} className={skillOn(c.skill) ? "primary" : ""} onClick={() => setSel(chooseSkill(sel, c.skill))}>
                {t("act.convert", { skill: reasonTitle(c.skill), card: cardTitle(c.as_name) })}
              </button>
            ))}
            {r.skills.map((s) => (
              <button key={s.skill} className={skillOn(s.skill) ? "primary" : ""} onClick={() => setSel(chooseSkill(sel, s.skill))}>
                {skillTitle(s.skill)}
              </button>
            ))}
            {sel.mode && (
              <>
                <button className="primary" disabled={!ready} onClick={submit}>
                  {t("act.use")}
                </button>
                <button onClick={() => setSel(EMPTY)}>{t("act.cancel")}</button>
              </>
            )}
            <button className="end-phase" onClick={() => answer(null)}>
              {t("act.endPhase")}
            </button>
          </>
        )}

        {r.kind === "respond" && (
          <>
            {r.conversions.map((c) => (
              <button key={c.skill} className={skillOn(c.skill) ? "primary" : ""} onClick={() => setSel(chooseSkill(sel, c.skill))}>
                {t("act.useSkill", { skill: reasonTitle(c.skill) })}
              </button>
            ))}
            <button className="primary" disabled={!ready} onClick={submit}>
              {t("act.play")}
            </button>
            <button onClick={() => answer(null)}>{t("act.dontPlay")}</button>
          </>
        )}

        {(r.kind === "discard" || r.kind === "choose_player") && (
          <button className="primary" disabled={!ready} onClick={submit}>
            {t("act.confirm")}
          </button>
        )}

        {r.kind === "confirm" && (
          <>
            <button className="primary" onClick={() => answer(true)}>
              {t("act.yes")}
            </button>
            <button onClick={() => answer(false)}>{t("act.no")}</button>
          </>
        )}

        {r.kind === "choose_option" &&
          r.choices.map((c) => (
            <button key={c} onClick={() => answer(c)}>
              {tMaybe(`opt.${c}`) ?? c}
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
            {r.hidden_count > 0 && <button onClick={() => answer("hand")}>{t("act.randomHand", { n: r.hidden_count })}</button>}
            {r.optional && <button onClick={() => answer(null)}>{t("act.none")}</button>}
          </>
        )}
      </div>
    </div>
  );
}
