import { SUIT_SYMBOL, cardInfo, cardTitle, rankText, useContent } from "../content";
import { t, tMaybe } from "../i18n";
import type { Card as CardData } from "../types";
import { Art } from "../components/Art";
import { CardArt, hasScene } from "./CardArt";
import { CardGlyph } from "./CardGlyph";
import { Tip, TipBody } from "./Tip";
import s from "./Card.module.css";

export type CardSize = "sm" | "md" | "lg";

interface Props {
  card: CardData;
  size?: CardSize;
  clickable?: boolean;
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
  note?: string; // small caption under the card (e.g. who played it)
  tip?: boolean; // rules tooltip on hover (default on)
}

function suitColor(c: CardData): "red" | "black" | "colorless" {
  if (c.virtual) return c.color === "red" ? "red" : c.color === "black" ? "black" : "colorless";
  return c.suit === "heart" || c.suit === "diamond" ? "red" : "black";
}

/** Rules tooltip contents for a card. */
export function CardTip({ name }: { name: string }) {
  const info = cardInfo(name);
  const tags = [tMaybe(`cardType.${info?.type ?? "basic"}`) ?? ""].filter(Boolean);
  if (info?.range) tags.push(t("card.range", { n: info.range }));
  return <TipBody title={cardTitle(name)} tags={tags} text={info?.text} />;
}

/** A rice-paper card: corner seal (rank + suit), art window, title, type band. */
export function Card({ card, size = "md", clickable, selected, dim, onClick, note, tip = true }: Props) {
  useContent();
  const type = cardInfo(card.name)?.type ?? "basic";
  const color = suitColor(card);
  const cls = [
    s.card,
    s[size],
    s[type],
    color === "red" ? s.red : color === "colorless" ? s.colorless : "",
    card.virtual ? s.virtual : "",
    clickable ? s.clickable : "",
    selected ? s.selected : "",
    dim ? s.dim : "",
    // stable hooks for tests and the table layout
    "card",
    clickable ? "clickable" : "",
    selected ? "selected" : "",
    dim ? "dim" : "",
  ].join(" ");
  const rank = card.virtual ? "" : rankText(card.rank);
  const suit = card.virtual ? "·" : SUIT_SYMBOL[card.suit];
  const label = `${cardTitle(card.name)}${card.virtual ? "" : ` ${suit}${rank}`}`;
  const glyphSize = size === "sm" ? 28 : size === "lg" ? 56 : 40;
  const body = (
    <>
      <span className={s.seal} aria-hidden="true">
        <span>{rank}</span>
        <span>{suit}</span>
      </span>
      <span className={s.art}>
        {/* your image if there is one; else the ink scene (the simple glyph on small cards,
            where a whole scene would be too busy to read) */}
        <Art
          kind="cards"
          id={card.name}
          fallback={size !== "sm" && hasScene(card.name) ? <CardArt name={card.name} /> : <CardGlyph name={card.name} type={type} size={glyphSize} />}
        />
      </span>
      <span className={s.title}>{cardTitle(card.name)}</span>
      <span className={s.band} />
      {note && <span className={s.note}>{note}</span>}
    </>
  );
  const el =
    clickable && onClick ? (
      <button type="button" className={cls} aria-pressed={!!selected} aria-label={label} onClick={onClick}>
        {body}
      </button>
    ) : (
      <div className={cls} role="img" aria-label={label}>
        {body}
      </div>
    );
  return tip ? <Tip content={<CardTip name={card.name} />}>{el}</Tip> : el;
}

/** The back of a card (draw pile, hidden hands). */
export function CardBack({ size = "md", label }: { size?: CardSize; label?: string }) {
  return (
    <div className={`${s.card} ${s[size]} ${s.back}`} role="img" aria-label={label ?? t("table.drawPile")}>
      <span className={s.backChar} lang="zh-CN">
        三
      </span>
    </div>
  );
}
