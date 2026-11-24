# Art slots

Drop images here and they replace the built-in ink illustrations. Refresh the page; no
rebuild or restart needed:

- `cards/<card id>.png|webp|jpg`: card art, e.g. `cards/strike.webp`. Landscape 10:7
  (e.g. 1000×700), cropped from the centre.
- `heroes/<hero id>.png|webp|jpg`: hero portraits, e.g. `heroes/wei_lie.png`.

Ids are the content ids from `/api/content` (and `server/content/*.py`).
`docs/art-prompts.md` has a consistent style and a subject for every card (for an image
generator or an artist). The gallery (`/?gallery`, "Card art") shows which cards have
images.
