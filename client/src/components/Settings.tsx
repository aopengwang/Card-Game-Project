import { useState } from "react";
import { t, useLang } from "../i18n";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { SCALE, autoScale, setScaleChoice, useScaleChoice, useUiScale } from "../uiScale";
import { LangToggle } from "./LangToggle";
import { KEY } from "./shortcuts";
import s from "./Settings.module.css";

const pct = (scale: number) => `${Math.round(scale * 100)}%`;
const PRESETS = [1, 1.25, 1.5];

/** Gear button (top bar, home, lobby) that opens the Settings dialog. */
export function SettingsButton() {
  useLang();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button shape="pill" className="settings-open" onClick={() => setOpen(true)} aria-label={t("settings.open")} title={t("settings.open")}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
        </svg>
      </Button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  useLang();
  const choice = useScaleChoice();
  const scale = useUiScale();
  // The slider shows where you're dragging; the size applies when you let go, so the
  // dialog doesn't grow or shrink under the pointer mid-drag.
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? scale;
  const commit = () => {
    if (drag != null) setScaleChoice(drag);
    setDrag(null);
  };
  const auto = choice === "auto";
  return (
    <Modal open title={t("settings.title")} onClose={onClose} className="settings-dialog">
      <section className={s.section}>
        <h3 className={s.label}>
          {t("settings.uiSize")} <span className={`${s.value} ui-size-value`}>{pct(shown)}</span>
        </h3>
        <div className={s.sliderRow}>
          <span className={s.end}>{t("settings.smaller")}</span>
          <input
            type="range"
            className={`${s.slider} ui-size`}
            min={SCALE.min}
            max={SCALE.max}
            step={SCALE.step}
            value={shown}
            aria-label={t("settings.uiSize")}
            aria-valuetext={pct(shown)}
            onChange={(e) => setDrag(Number(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
          />
          <span className={s.end}>{t("settings.bigger")}</span>
        </div>
        <div className={s.presets}>
          <Button shape="small" aria-pressed={auto} className={auto ? s.on : ""} onClick={() => setScaleChoice("auto")}>
            {t("settings.auto")} ({pct(autoScale(window.innerWidth, window.innerHeight))})
          </Button>
          {PRESETS.map((p) => (
            <Button key={p} shape="small" aria-pressed={!auto && choice === p} className={!auto && choice === p ? s.on : ""} onClick={() => setScaleChoice(p)}>
              {pct(p)}
            </Button>
          ))}
        </div>
        <p className={s.hint}>{t("settings.autoHint")}</p>
      </section>

      <section className={s.section}>
        <h3 className={s.label}>{t("settings.language")}</h3>
        <div>
          <LangToggle />
        </div>
      </section>

      <section className={s.section}>
        <h3 className={s.label}>{t("settings.keys")}</h3>
        <dl className={s.keys}>
          {[
            ["1–9", t("keys.card")],
            ["↵ Enter", t("keys.main")],
            ["Esc", t("keys.back")],
            [KEY.end.toUpperCase(), t("keys.end")],
          ].map(([k, what]) => (
            <div key={k} className={s.keyRow}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className={s.actions}>
        <Button variant="primary" onClick={onClose}>
          {t("settings.done")}
        </Button>
      </div>
    </Modal>
  );
}
