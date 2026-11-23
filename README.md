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

Tuning (env vars, seconds): `SGS_PLAY_TIMEOUT` (90), `SGS_RESPONSE_TIMEOUT` (20),
`SGS_BOT_DELAY` (0.6). Rooms live in memory; restarting the server ends all games.

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
  all sharing `SkillBase` modifiers (range, distance, hand limit, targeting) and flags
  (`locked`, `lord`, `limited`, `awakening`, `per_turn`). A skill's docstring is its
  rules text shown to players. Heroes use historical figures with our own skill designs.
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
- **Adding content or UI? Add both languages.** Skill names in Chinese are our own designs.
- The `/debug` test client and `sim.py` are English-only developer tools.

## Bots
Two levels; the host picks one per bot in the lobby (humans who disconnect are covered by "hard").
- **easy** (`bots/simple.py`): legal moves, only knows who the Lord is.
- **hard** (`bots/smart.py`): infers allegiances from public actions (attacks, saves,
  Nullifies, Shield Wall), plays its role (Rebels focus the Lord; the Spy keeps the sides
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
4. [x] Skill system + first original heroes (13 historical figures with original skills, hero draft)
5. [x] FastAPI WebSocket server: rooms, invite codes, timeouts, reconnect, AFK bot takeover
   (+ a plain-HTML test client at `/debug`)
6. [x] React client: table layout, hero draft, targeting, timers, animations, art slots, mobile
7. [ ] Better bots (hard level done), expansions, replays
