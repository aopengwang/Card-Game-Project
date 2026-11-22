# Art slots

Drop PNG files here and they show up in the game automatically (rebuild the client
with `npm run build` if you're serving `dist/` from the Python server):

- `cards/<card id>.png` - card art, e.g. `cards/strike.png`, `cards/eight_trigrams.png`
- `heroes/<hero id>.png` - hero portraits, e.g. `heroes/wei_lie.png`, `heroes/zhuge_liang.png`

Ids are the content ids from `/api/content` (and `server/content/*.py`).
Anything missing falls back to a styled placeholder. Square-ish images look best.
