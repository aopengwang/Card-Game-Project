import { useEffect, useState } from "react";
import { t, useLang } from "../i18n";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { play, setMuted, setVolume, useSoundPrefs } from "../sound";
import { ALL, OFF, loadMusic, setMusicVolume, setTrack, useMusic } from "../music";
import { SCALE, autoScale, setScaleChoice, useScaleChoice, useUiScale } from "../uiScale";
import { LangToggle } from "./LangToggle";
import { KEY } from "./shortcuts";
import s from "./Settings.module.css";

const pct = (scale: number) => `${Math.round(scale * 100)}%`;
const PRESETS = [0.75, 1, 1.25, 1.5];

const SpeakerIcon = ({ muted }: { muted: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 9h4l5-4v14l-5-4H4Z" />
    {muted ? <path d="m17 9 5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
  </svg>
);

/** Top-bar speaker: mute / unmute in one click. */
export function MuteButton() {
  useLang();
  const { muted, volume } = useSoundPrefs();
  const music = useMusic();
  // (silent effects with music playing isn't "off": the button still mutes the music)
  const off = muted || (volume === 0 && (music.choice === OFF || music.volume === 0));
  return (
    <Button
      shape="pill"
      className="mute-toggle"
      aria-pressed={off}
      aria-label={off ? t("settings.unmute") : t("settings.mute")}
      title={off ? t("settings.unmute") : t("settings.mute")}
      onClick={() => (off ? (setMuted(false), volume === 0 && setVolume(0.6)) : setMuted(true))}
    >
      <SpeakerIcon muted={off} />
    </Button>
  );
}

function SoundSettings() {
  const { muted, volume } = useSoundPrefs();
  return (
    <section className={s.section}>
      <h3 className={s.label}>
        {t("settings.sound")} <span className={s.value}>{muted ? "—" : `${Math.round(volume * 100)}%`}</span>
      </h3>
      <div className={s.sliderRow}>
        <Button shape="small" aria-pressed={muted} className={muted ? s.on : ""} onClick={() => setMuted(!muted)} aria-label={muted ? t("settings.unmute") : t("settings.mute")}>
          <SpeakerIcon muted={muted} />
        </Button>
        <input
          type="range"
          className={`${s.slider} volume`}
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          aria-label={t("settings.volume")}
          aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
          onChange={(e) => setVolume(Number(e.target.value))}
          onPointerUp={() => play("card")}
        />
        <Button shape="small" onClick={() => play("turn")}>
          {t("settings.test")}
        </Button>
      </div>
      <p className={s.hint}>{t("settings.soundHint")}</p>
    </section>
  );
}

/** Background music: which track this player hears (files in client/public/music). */
function MusicSettings() {
  const { muted } = useSoundPrefs();
  const { tracks, choice, volume } = useMusic();
  useEffect(() => void loadMusic(), []); // newly added files show up without a refresh
  const picked = choice === ALL || tracks.some((tr) => tr.id === choice) ? choice : OFF;
  const option = (id: string, name: string) => (
    <Button
      key={id}
      shape="small"
      aria-pressed={picked === id}
      className={`${picked === id ? s.on : ""} bgm-option`}
      onClick={() => {
        if (id !== OFF && muted) setMuted(false); // asking for music means wanting to hear it
        setTrack(id);
      }}
    >
      {name}
    </Button>
  );
  return (
    <section className={`${s.section} bgm-settings`}>
      <h3 className={s.label}>
        {t("settings.music")} <span className={s.value}>{muted || picked === OFF ? "—" : `${Math.round(volume * 100)}%`}</span>
      </h3>
      {tracks.length === 0 ? (
        <p className={s.hint}>{t("settings.musicEmpty")}</p>
      ) : (
        <>
          <div className={`${s.presets} ${s.tracks}`} role="group" aria-label={t("settings.music")}>
            {option(OFF, t("settings.musicOff"))}
            {tracks.length > 1 && option(ALL, t("settings.musicAll"))}
            {tracks.map((tr) => option(tr.id, tr.name))}
          </div>
          <div className={s.sliderRow}>
            <input
              type="range"
              className={`${s.slider} music-volume`}
              min={0}
              max={1}
              step={0.05}
              value={volume}
              aria-label={t("settings.musicVolume")}
              aria-valuetext={`${Math.round(volume * 100)}%`}
              onChange={(e) => {
                if (muted) setMuted(false);
                setMusicVolume(Number(e.target.value));
              }}
            />
          </div>
        </>
      )}
    </section>
  );
}

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

      <SoundSettings />

      <MusicSettings />

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
            ["T", t("keys.chat")],
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
