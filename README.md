# Cardgame

An online hidden-role card game (Lord / Loyalist / Rebel / Spy) inspired by 三国杀,
playable with friends from a browser link.

## Layout
```
server/            Python 3.11+
  engine/          pure rules engine: no I/O, seeded RNG, generator-based prompts
  content/         card definitions + deck (standard ruleset)
  bots/            bots: simple.py ("easy"), smart.py ("hard"), arena.py (head-to-head stats)
  tests/           pytest suite (unit rules + hundreds of bot games)
  net/             FastAPI app: rooms, websocket protocol, static test client
  sim.py           watch a bot game in the terminal
client/            React 19 + TypeScript + Vite
  src/selection.ts what's clickable / when an answer is complete (pure, unit-tested)
  src/net.ts       websocket store: reconnects, session token in localStorage
  src/components/  Table (arena, seats, hand, action bar), hero pick, lobby, log
  public/art/      drop card/hero PNGs here (see README there)
```

## Client
```powershell
cd client
npm install
npm run build     # -> client/dist, served by the Python server at "/"
npm test          # unit tests
npm run dev       # live-reload dev server on :5173 (proxies to the Python server on :8000)
```
Without a build, "/" falls back to the plain test client, which is always at `/debug`.

### Design system, gallery, browser tests
- **Ink & Lacquer tokens**: `client/src/styles/tokens.css` (colors, fonts per language,
  spacing, shadows, motion). Components use `var(--ik-…)`, never raw values.
  `tokens.test.ts` checks text contrast (WCAG AA) and that JS motion timings match.
- **Components** (`client/src/ui/`): Card, Plaque (seat), RoleSeal, Beads (HP), TimerRing,
  Portrait, Button / SealButton, Modal (Radix Dialog), Tip (Radix Tooltip). Build new UI
  from these; the gallery shows each one in every state.
- **Table layout** (`client/src/layout.ts`): a fixed frame (top bar, table, dock). Seats and
  the battlefield are placed in pixels from the table's size only (`tableLayout`), plaques
  have a fixed height, and the hand fans instead of growing, so nothing moves while you
  play. Unit tests check no seat overlaps another or the battlefield at any size;
  `e2e/stability.spec.ts` plays real games at four window sizes and fails if any part of
  the frame moves by a pixel.
- **Motion** (`client/src/components/Effects.tsx`): played cards fly from the seat to the
  battlefield, an ink stroke runs to each target, damage/healing float over the seat, your
  turn opens with a banner, and a dashed line shows the targets you're aiming at. A death
  plays the **killing blow** (`client/src/fx/`): the killer's hero card lifts off, flies
  over the victim and slams down on it. Big moments like that queue on a `Stage`
  (`fx/stage.ts`) and play one at a time. It's a layer over the table (never moves the
  layout), only animates what happens while you watch, and is off with the system
  "reduce motion" setting.
- **Keyboard**: `1`-`9` pick a hand card, `Enter` the main action (Use / Play / Confirm /
  Yes), `Esc` back out (Cancel / Don't play / No), `E` end your play phase. Buttons show
  their key; add one with `<Button shortcut=…>` (`components/shortcuts.ts`).
- **Gallery**: open `/?gallery` (add `&lang=zh` for Chinese). It shows the palette and
  type, plus real game moments rendered by the live UI: hero pick, Nullify chain,
  dying, 8 players, game over, and more. Regenerate the moments from seeded hard-bot
  games with `cd server; python -m tools.dump_fixtures`.
- **Animation lab**: open `/?fx` (or `/?fx=kill`, `double`, `fate`, `strike`, `heal`,
  `turn`; add `&lang=zh`). It replays one effect on a real table: pick the effect, who
  kills whom and the speed (1x / 0.5x / 0.25x), then press Play or `P`. Use it to tune a
  new animation in seconds instead of playing games. To add an effect, add an entry to
  `EFFECTS` in `client/src/dev/FxLab.tsx` listing the log entries a game would send.
- **Developer URLs** (client, served by the game server; not linked from the game):

  | URL | What it shows |
  |-----|---------------|
  | `/?gallery` | palette, type, card art, hero cards, and every captured game moment |
  | `/?gallery=<moment>` | one captured moment on the live table, e.g. `/?gallery=play_strike` |
  | `/?fx` | the animation lab above |
  | `/debug` | the plain test client (also what `/` shows without a build) |
  | `/?room=CODE` | join a room from an invite link |

  Add `&lang=zh` (or `&lang=en`) to any of them to pick the language.
- **Browser tests** (Playwright, uses your installed Chrome): `cd client; npm run e2e`.
  For every gallery moment (desktop English and phone Chinese) it checks that nothing
  covers a clickable card/seat/button, that phones never scroll sideways, and compares a
  screenshot. It also plays two full games through the UI (English, and Chinese with a
  live switch to English), checks the home and lobby screens (`screens.spec.ts`), table
  motion and keyboard play (`motion.spec.ts`), the killing blow (`fx.spec.ts`, replayed
  in the animation lab) and that the table never moves (`stability.spec.ts`). After an intended visual change, refresh the baselines with
  `npm run e2e -- --update-snapshots` and look at the new images before committing.

## Dev
```powershell
cd server
python -m venv .venv
.\.venv\Scripts\python -m pip install fastapi "uvicorn[standard]" pytest httpx
.\.venv\Scripts\python -m pytest -q
.\.venv\Scripts\python sim.py --players 5 --seed 7
```

## Run the server and play
```powershell
cd client; npm install; npm run build; cd ..   # once, and after client changes
cd server
.\.venv\Scripts\python -m uvicorn net.app:app --host 0.0.0.0 --port 8000
```
Open http://localhost:8000, create a room, and send friends the invite link
(`/?room=CODE`). The host can add bots and start with 4-8 players. Refreshing or
reconnecting keeps your seat (a bot plays for you while you're gone).

To let friends outside your network join, either:
- **Tailscale**: everyone installs Tailscale and joins your tailnet; share
  `http://<your-tailscale-ip>:8000`. Nothing is exposed to the public internet.
- **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:8000` prints a
  public `https://….trycloudflare.com` URL (websockets work through it).

Defaults (env vars, seconds): `SGS_PLAY_TIMEOUT` (90), `SGS_RESPONSE_TIMEOUT` (20),
`SGS_BOT_DELAY` (0.6). Each room starts from these and the host can change the turn
time, response time, hero-pick/discard time and bot speed in the lobby (within
`OPTION_LIMITS` in `net/room.py`). The lobby's "Heroes in the draft" panel shows every
hero as a small card (hover for its skills); the host clicks one to leave it out of the
hero pick or put it back. At least 4 must stay in, and at least one per player to start.
Rooms live in memory; restarting the server ends all games.

**Card art**: every card has a built-in ink illustration (`client/src/ui/CardArt.tsx`).
Drop `client/public/art/cards/<id>.png|webp|jpg` to replace one, then refresh; no rebuild
needed. `docs/art-prompts.md` has a matching style and subject per card for an image
generator or artist; the gallery's "Card art" section shows which cards have images.

**Sound** (`client/src/sound.ts`): synthesized in the browser, no audio files. Card plays,
equipment, damage, healing, your-turn bell, last-seconds ticks, deaths, victory/defeat.
Volume and mute are in Settings, and there's a speaker button in the table's top bar.

**Settings** (gear button, any screen): interface size scales the whole app. "Auto"
(the default) grows it on big monitors; or pick 80–160%. Remembered per browser
(`client/src/uiScale.ts`).

## How the engine works
- Every action that might need a decision is a generator. It `yield`s a `Request`
  (`PlayRequest`, `RespondRequest`, `DiscardRequest`) and gets the answer via `send()`.
  Invalid answers are re-asked with `req.error` set.
- `Game.run()` plays a whole game and returns a `GameResult`.
- Skills hook into `Event`s (damage, card used, phase start, ...) via `engine.Skill`.
  Equipment subclasses `engine.EquipDef`: static modifiers (range, horses) plus an
  optional `skill`, `view_as` conversion, or `assist` (armor that provides a Dodge).
- Conversions (`engine.ViewAs`) let cards be used *as* another card; the engine builds a
  virtual card (negative id) and moves the physical `subcards`.
- Heroes (`content/heroes.py`) are a name, kingdom, HP, gender and a tuple of skills.
  Skill kinds: `Skill` (triggered), `ViewAs` (conversion), `ActiveSkill` (play phase),
  all sharing `SkillBase` modifiers (range, distance, hand limit, targeting, double
  responses, trick reach, Peach-save bonus) and flags (`locked`, `lord`, `limited`,
  `awakening`, `per_turn`). A skill's docstring is its rules text shown to players.
- The roster is the **25 heroes of the standard set** (Wei 7, Shu 7, Wu 8, Qun 3), each
  skill playing like its classic counterpart under our own name and rules text (e.g. Zhuge
  Liang's *Star Chart* rearranges the top of the deck), plus two heroes of our own (Wei
  Lie, Yu Ji). Engine support they rely on: arranging the deck (`ArrangeRequest`),
  optional player picks, redirecting a Strike (`Event.BECOME_TARGET`), losing HP
  (`lose_hp`), a card placed in a judgment area *as* a delayed trick (`judge_as`), and
  knowing which zone a moved card came from (`CardsMoved.left`).
- `new_game(n, seed, draft=True)` for real games; tests pass `heroes=[...]` per seat.
- `engine.view.view_for(game, seat)` / `log_for(...)` are the only things a client
  should ever see (hidden hands/roles are filtered out).

## Languages (English / 中文)
The game is fully playable in English and Simplified Chinese. Players switch with the
English/中文 button on any screen. The default follows the browser language and the
choice is remembered.
- **UI text, prompts, log lines** live in `client/src/i18n.ts`. The `zh` dictionary is
  typed against `en`, so an untranslated new string fails the build, and
  `i18n.test.ts` checks every Chinese string keeps the same `{placeholders}`.
- **Cards, heroes, skills**: English is in the content itself (docstrings, names); Chinese
  is in `server/content/i18n.py`. `tests/test_i18n.py` fails if any card, hero or skill
  lacks a Chinese entry. The client fetches `/api/content?lang=en|zh`.
- Server error messages are English; the client translates the known ones (`serverText`).
- **Adding content or UI? Add both languages.** Skill names and rules text (English and
  Chinese) are our own wording, never the official skill names.
- The `/debug` test client and `sim.py` are English-only developer tools.

## Bots
Two levels; the host picks one per bot in the lobby (humans who disconnect are covered by "hard").
- **easy** (`bots/simple.py`): legal moves, only knows who the Lord is.
- **hard** (`bots/smart.py`): infers allegiances from public actions (attacks, saves,
  Nullifies, playing a card for the Lord, passing a Strike on), plays its role (Rebels focus the Lord; the Spy keeps the sides
  balanced, then turns on everyone, Lord last), values cards, picks targets by HP/armor,
  only uses area attacks when they favour its side. It only sees what a human in its seat
  could; `tests/test_smart_bot.py` re-deals the hidden cards mid-game and checks its
  decisions don't change.

Compare levels: `python -m bots.arena --games 300 --players 5`. Watch one:
`python sim.py --level hard --seed 3`.

## Milestones
1. [x] Engine core: zones, deck, phases, Strike/Dodge/Peach, roles, dying/death, win checks
2. [x] Tricks (incl. Nullify chains), judgments, delayed tricks (Borrowed Sword waits for weapons)
3. [x] Equipment + distance modifiers, conversions ("use X as a Strike"), full 108-card deck
4. [x] Skill system + heroes: the standard 25 (classic mechanics, our own names) + 2 extras, hero draft
5. [x] FastAPI WebSocket server: rooms, invite codes, timeouts, reconnect, AFK bot takeover
   (+ a plain-HTML test client at `/debug`)
6. [x] React client: table layout, hero draft, targeting, timers, animations, art slots, mobile
7. [ ] Better bots (hard level done), Kingdom Wars mode (60 heroes, dual heroes), expansions, replays
