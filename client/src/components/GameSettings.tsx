import { t, tMaybe, useLang } from "../i18n";
import { send } from "../net";
import type { GameOptions, RoomInfo } from "../types";
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
      </div>
      {!isHost && <p className={s.note}>{t("game.hostOnly")}</p>}
    </div>
  );
}
