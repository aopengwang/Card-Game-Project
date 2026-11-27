import { useEffect, useMemo, useState } from "react";
import { cardTitle, heroName, kingdomName, SUIT_SYMBOL, useContent } from "../content";
import { t, tMaybe, useLang } from "../i18n";
import { send } from "../net";
import type { GameView, RoomInfo } from "../types";
import { Button } from "../ui/Button";
import s from "./TestPanel.module.css";

const SUITS = ["spade", "heart", "club", "diamond"] as const;
const KINGDOMS = ["wei", "shu", "wu", "qun"];
const TYPES = ["basic", "trick", "equipment"] as const;

/**
 * Test room tools (server: engine/sandbox.py): switch anyone's hero, hand out any card,
 * stack the deck, set HP, and keep the bots still. It stays open while you play, so you
 * can try a skill, change something, and try again.
 */
export function TestPanel({ room, view, name }: { room: RoomInfo; view: GameView; name: (seat: number) => string }) {
  useLang();
  const content = useContent();
  const [open, setOpen] = useState(false);
  const [seat, setSeat] = useState(view.you);
  const target = view.players[seat] ?? view.players[view.you];
  const [hero, setHero] = useState(target.hero);
  const [card, setCard] = useState("strike");
  const [suit, setSuit] = useState("any");
  const [hp, setHp] = useState(target.hp);
  const aura = target.tokens?.aura ?? 0;
  const [tokens, setTokens] = useState(aura);
  const hasAura = target.skills.some((sk) => sk.id === "do_nothing_win");

  // Show the chosen player's current hero, HP and tokens whenever they (or the player) change.
  useEffect(() => setHero(target.hero), [target.hero, seat]);
  useEffect(() => setHp(target.hp), [target.hp, seat]);
  useEffect(() => setTokens(aura), [aura, seat]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  const heroes = useMemo(() => {
    const kingdoms = [...new Set([...KINGDOMS, ...content.heroes.map((h) => h.kingdom)])];
    return kingdoms
      .map((k) => ({ k, list: content.heroes.filter((h) => h.kingdom === k).sort((a, b) => a.name.localeCompare(b.name)) }))
      .filter((g) => g.list.length);
  }, [content.heroes]);
  const cards = useMemo(
    () =>
      TYPES.map((type) => ({
        type,
        list: Object.entries(content.cards)
          .filter(([, c]) => c.type === type)
          .map(([id]) => id)
          .sort((a, b) => cardTitle(a).localeCompare(cardTitle(b))),
      })).filter((g) => g.list.length),
    [content.cards],
  );

  const test = (msg: Record<string, unknown>) => send({ type: "test", ...msg });
  const cardMsg = { name: card, suit: suit === "any" ? null : suit };

  return (
    <div className={`${s.wrap} test-panel`}>
      <Button shape="pill" className="test-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("test.open")}
      </Button>
      {open && (
        <section className={s.panel} role="dialog" aria-modal="false" aria-label={t("test.title")}>
          <header className={s.head}>
            <h2>{t("test.title")}</h2>
            <button type="button" className={s.close} aria-label={t("test.close")} onClick={() => setOpen(false)}>
              ×
            </button>
          </header>

          <label className={s.field}>
            <span>{t("test.player")}</span>
            <select value={seat} onChange={(e) => setSeat(Number(e.target.value))} name="test-seat">
              {view.players.map((p) => (
                <option key={p.seat} value={p.seat} disabled={!p.alive}>
                  {name(p.seat)} · {heroName(p.hero)} ({p.hp}/{p.max_hp})
                </option>
              ))}
            </select>
          </label>

          <div className={s.row}>
            <label className={s.field}>
              <span>{t("test.hero")}</span>
              <select value={hero} onChange={(e) => setHero(e.target.value)} name="test-hero">
                {heroes.map((g) => (
                  <optgroup key={g.k} label={kingdomName(g.k)}>
                    {g.list.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.max_hp})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <Button shape="small" variant="primary" onClick={() => test({ action: "hero", seat, hero })}>
              {t("test.become")}
            </Button>
          </div>

          <div className={s.row}>
            <label className={s.field}>
              <span>{t("test.card")}</span>
              <select value={card} onChange={(e) => setCard(e.target.value)} name="test-card">
                {cards.map((g) => (
                  <optgroup key={g.type} label={tMaybe(`cardType.${g.type}`) ?? g.type}>
                    {g.list.map((id) => (
                      <option key={id} value={id}>
                        {cardTitle(id)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className={`${s.field} ${s.narrow}`}>
              <span>{t("test.suit")}</span>
              <select value={suit} onChange={(e) => setSuit(e.target.value)} name="test-suit">
                <option value="any">{t("test.anySuit")}</option>
                {SUITS.map((x) => (
                  <option key={x} value={x}>
                    {SUIT_SYMBOL[x]} {tMaybe(`opt.${x}`)?.replace(/^\S+\s/, "") ?? x}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={s.buttons}>
            <Button shape="small" variant="primary" onClick={() => test({ action: "card", seat, ...cardMsg })}>
              {t("test.toHand")}
            </Button>
            <Button shape="small" onClick={() => test({ action: "top", ...cardMsg })}>
              {t("test.toTop")}
            </Button>
          </div>

          <div className={s.row}>
            <label className={`${s.field} ${s.narrow}`}>
              <span>{t("test.hp")}</span>
              <input
                type="number"
                name="test-hp"
                min={1}
                max={target.max_hp}
                value={hp}
                onChange={(e) => setHp(Number(e.target.value))}
              />
            </label>
            <Button shape="small" onClick={() => test({ action: "hp", seat, hp })}>
              {t("test.setHp")}
            </Button>
          </div>

          {hasAura && (
            <div className={s.row}>
              <label className={`${s.field} ${s.narrow}`}>
                <span>{t("test.tokens")}</span>
                <input
                  type="number"
                  name="test-tokens"
                  min={0}
                  max={4}
                  value={tokens}
                  onChange={(e) => setTokens(Number(e.target.value))}
                />
              </label>
              <Button shape="small" onClick={() => test({ action: "tokens", seat, token: "aura", count: tokens })}>
                {t("test.setTokens")}
              </Button>
            </div>
          )}

          <label className={s.check}>
            <input
              type="checkbox"
              name="test-control"
              checked={!!room.you_control}
              onChange={(e) => test({ action: "control", on: e.target.checked })}
            />
            <span>{t("test.control")}</span>
          </label>
          {room.control_bots && !room.you_control && <p className={s.note}>{t("test.controlledByOther")}</p>}
          <label className={s.check}>
            <input
              type="checkbox"
              name="test-passive"
              checked={room.passive_bots ?? true}
              disabled={!!room.control_bots}
              onChange={(e) => test({ action: "bots", passive: e.target.checked })}
            />
            <span>{t("test.passive")}</span>
          </label>
          <p className={s.note}>{t("test.note")}</p>
        </section>
      )}
    </div>
  );
}
