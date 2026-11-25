import { useEffect, useState } from "react";
import { t, tMaybe, useLang } from "../i18n";
import { send } from "../net";
import type { GameOptions, RoomInfo } from "../types";
import { Button } from "../ui/Button";
import s from "./Screens.module.css";

type Key = keyof GameOptions;

// Offered choices per option (seconds). Only those inside the server's limits are shown,
// plus the room's current value if it isn't one of them (e.g. a server default).
const CHOICES: Record<Key, number[]> = {
  play_timeout: [30, 45, 60, 90, 120, 180, 300],
  response_timeout: [10, 15, 20, 30, 45, 60],
  hero_timeout: [30, 45, 60, 90, 120, 180],
  bot_delay: [0, 0.3, 0.6, 1.2, 2],
};
const SPEED: Record<string, string> = { "0": "instant", "0.3": "fast", "0.6": "normal", "1.2": "slow", "2": "relaxed" };
const ORDER: Key[] = ["play_timeout", "response_timeout", "hero_timeout", "bot_delay"];

function label(key: Key, v: number): string {
  if (key === "bot_delay") {
    const name = tMaybe(`speed.${SPEED[String(v)]}`);
    return name ? `${name} (${t("game.seconds", { n: v })})` : t("game.seconds", { n: v });
  }
  return t("game.seconds", { n: v });
}

/** The host sets, changes or removes the room password (guests only see whether there is one). */
function PasswordField({ room }: { room: RoomInfo }) {
  const current = room.password ?? "";
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]); // the server confirmed a change
  const changed = value.trim() !== "" && value !== current;
  return (
    <form
      className={s.password}
      onSubmit={(e) => {
        e.preventDefault();
        if (changed) send({ type: "password", password: value });
      }}
    >
      <label htmlFor="opt-password">{t("game.password")}</label>
      <div className={s.passwordRow}>
        <input
          id="opt-password"
          value={value}
          maxLength={40}
          autoComplete="off"
          placeholder={t("game.passwordPlaceholder")}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" shape="small" disabled={!changed}>
          {t("game.passwordSet")}
        </Button>
        {room.locked && (
          <Button shape="small" variant="ghost" onClick={() => send({ type: "password", password: null })}>
            {t("game.passwordRemove")}
          </Button>
        )}
      </div>
      <span className={s.note}>{room.locked ? t("game.passwordHintOn") : t("game.passwordHintOff")}</span>
    </form>
  );
}

/** The room's game settings: the host picks them, everyone else sees them. */
export function GameSettings({ room }: { room: RoomInfo }) {
  useLang();
  const opts = room.options;
  if (!opts) return null;
  const isHost = room.you === room.host;
  const editable = isHost && room.status !== "playing";
  const limits = room.option_limits;
  return (
    <div className="game-settings">
      <h2 className={s.subhead}>{t("game.settings")}</h2>
      <div className={s.options}>
        {ORDER.map((key) => {
          const [lo, hi] = limits?.[key] ?? [-Infinity, Infinity];
          const choices = [...new Set([...CHOICES[key].filter((v) => v >= lo && v <= hi), opts[key]])].sort((a, b) => a - b);
          const id = `opt-${key}`;
          return (
            <div key={key} className={s.option}>
              <label htmlFor={id}>{t(`game.${key}`)}</label>
              {editable ? (
                <select
                  id={id}
                  value={opts[key]}
                  onChange={(e) => send({ type: "settings", settings: { [key]: Number(e.target.value) } })}
                >
                  {choices.map((v) => (
                    <option key={v} value={v}>
                      {label(key, v)}
                    </option>
                  ))}
                </select>
              ) : (
                <output id={id} className={s.optionValue}>
                  {label(key, opts[key])}
                </output>
              )}
            </div>
          );
        })}
        {room.battle != null && (
          <div className={s.option} title={t("game.battleHint")}>
            <label htmlFor="opt-battle">{t("game.battle")}</label>
            {editable ? (
              <select
                id="opt-battle"
                value={room.battle ? "on" : "off"}
                onChange={(e) => send({ type: "deck", battle: e.target.value === "on" })}
              >
                <option value="on">{t("game.battleOn")}</option>
                <option value="off">{t("game.battleOff")}</option>
              </select>
            ) : (
              <output id="opt-battle" className={s.optionValue}>
                {room.battle ? t("game.battleOn") : t("game.battleOff")}
              </output>
            )}
          </div>
        )}
        {room.sandbox != null && (
          <div className={s.option} title={t("game.sandboxHint")}>
            <label htmlFor="opt-sandbox">{t("game.sandbox")}</label>
            {editable ? (
              <select
                id="opt-sandbox"
                value={room.sandbox ? "on" : "off"}
                onChange={(e) => send({ type: "sandbox", on: e.target.value === "on" })}
              >
                <option value="off">{t("game.sandboxOff")}</option>
                <option value="on">{t("game.sandboxOn")}</option>
              </select>
            ) : (
              <output id="opt-sandbox" className={s.optionValue}>
                {room.sandbox ? t("game.sandboxOn") : t("game.sandboxOff")}
              </output>
            )}
          </div>
        )}
      </div>
      {room.battle && <p className={s.note}>{t("game.battleHint")}</p>}
      {room.sandbox && <p className={`${s.note} sandbox-note`}>{t("game.sandboxHint")}</p>}
      {isHost ? (
        <PasswordField room={room} />
      ) : (
        <div className={s.option}>
          <span>{t("game.password")}</span>
          <output className={`${s.optionValue} room-locked`}>{room.locked ? t("game.passwordOn") : t("game.passwordOff")}</output>
        </div>
      )}
      {!isHost && <p className={s.note}>{t("game.hostOnly")}</p>}
    </div>
  );
}
