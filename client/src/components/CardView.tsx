import { SUIT_SYMBOL, cardTitle, isRed, rankText, useContent } from "../content";
import { t } from "../i18n";
import type { Card } from "../types";
import { Art } from "./Art";

const TYPE_GLYPH: Record<string, string> = { basic: "◆", trick: "✦", equipment: "⛨" };

interface Props {
  card: Card;
  size?: "sm" | "md";
  clickable?: boolean;
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
  note?: string;
}

export function CardView({ card, size = "md", clickable, selected, dim, onClick, note }: Props) {
  const content = useContent();
  const info = content.cards[card.name];
  const type = info?.type ?? "basic";
  const cls = [
    "card",
    `card-${size}`,
    `type-${type}`,
    isRed(card) ? "red" : "black",
    clickable ? "clickable" : "",
    selected ? "selected" : "",
    dim ? "dim" : "",
  ].join(" ");
  const corner = card.virtual ? "" : `${rankText(card.rank)}${SUIT_SYMBOL[card.suit]}`;
  const body = (
    <>
      <span className="card-corner">{corner}</span>
      <Art kind="cards" id={card.name} className="card-art" fallback={<span className="card-glyph">{TYPE_GLYPH[type]}</span>} />
      <span className="card-title">{cardTitle(card.name)}</span>
      {note && <span className="card-note">{note}</span>}
    </>
  );
  const tip = info ? `${info.title}${info.range ? ` (${t("card.range", { n: info.range })})` : ""}: ${info.text}` : card.name;
  if (onClick && clickable) {
    return (
      <button type="button" className={cls} title={tip} aria-pressed={selected} onClick={onClick}>
        {body}
      </button>
    );
  }
  return (
    <div className={cls} title={tip}>
      {body}
    </div>
  );
}

/** One-line chip for equipment / judgment areas on a seat. */
export function CardChip({ card }: { card: Card }) {
  const content = useContent();
  const info = content.cards[card.name];
  return (
    <span className={`chip ${isRed(card) ? "red" : "black"}`} title={info ? `${info.title}: ${info.text}` : card.name}>
      {cardTitle(card.name)}
      {!card.virtual && <span className="chip-suit"> {SUIT_SYMBOL[card.suit]}{rankText(card.rank)}</span>}
    </span>
  );
}
