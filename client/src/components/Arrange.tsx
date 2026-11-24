import { useState } from "react";
import { reasonTitle, useContent } from "../content";
import { serverText, t, useLang } from "../i18n";
import { answer } from "../net";
import type { ArrangeReq } from "../types";
import { Button } from "../ui/Button";
import { Card as CardFace } from "../ui/Card";
import { Modal } from "../ui/Modal";
import s from "./Overlays.module.css";
import { KEY } from "./shortcuts";

type Where = "top" | "bottom";

/**
 * Put cards you are looking at back on the deck: some on top in the order you choose (the
 * first is drawn first), the rest at the bottom. Only you see these cards.
 */
export function Arrange({ req }: { req: ArrangeReq }) {
  useLang();
  useContent();
  const faces = new Map(req.cards.map((c) => [c.id, c]));
  const [rows, setRows] = useState<Record<Where, number[]>>({ top: req.options, bottom: [] });

  const move = (id: number, from: Where) => {
    const to: Where = from === "top" ? "bottom" : "top";
    setRows({ [from]: rows[from].filter((x) => x !== id), [to]: [...rows[to], id] } as Record<Where, number[]>);
  };
  const shift = (where: Where, i: number, by: number) => {
    const list = [...rows[where]];
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setRows({ ...rows, [where]: list });
  };

  const row = (where: Where) => (
    <section className={s.arrangeRow} aria-label={t(`arrange.${where}`)}>
      <h3 className={s.arrangeLabel}>{t(`arrange.${where}`)}</h3>
      <ol className={`${s.arrangeCards} arrange-${where}`}>
        {rows[where].length === 0 && <li className={s.arrangeEmpty}>{t("arrange.empty")}</li>}
        {rows[where].map((id, i) => {
          const card = faces.get(id);
          return (
            <li key={id} className={`${s.arrangeSlot} arrange-card`} data-card={id}>
              <span className={s.arrangeOrder} aria-hidden="true">
                {i + 1}
              </span>
              {card && <CardFace card={card} size="md" />}
              <span className={s.arrangeTools}>
                <Button shape="small" variant="ghost" aria-label={t("arrange.earlier")} disabled={i === 0} onClick={() => shift(where, i, -1)}>
                  ←
                </Button>
                {req.allow_bottom && (
                  <Button shape="small" onClick={() => move(id, where)}>
                    {where === "top" ? t("arrange.toBottom") : t("arrange.toTop")}
                  </Button>
                )}
                <Button
                  shape="small"
                  variant="ghost"
                  aria-label={t("arrange.later")}
                  disabled={i === rows[where].length - 1}
                  onClick={() => shift(where, i, 1)}
                >
                  →
                </Button>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );

  return (
    <Modal open wide dismissible={false} title={t("arrange.title", { reason: reasonTitle(req.reason) })} description={t("arrange.hint")}>
      {req.error && <div className={s.error}>{serverText(req.error)}</div>}
      {row("top")}
      {req.allow_bottom && row("bottom")}
      <div className={s.arrangeActions}>
        <Button variant="primary" onClick={() => answer({ top: rows.top, bottom: rows.bottom })} shortcut={KEY.main}>
          {t("act.confirm")}
        </Button>
      </div>
    </Modal>
  );
}
