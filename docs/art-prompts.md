# Card art prompts

Every card ships with a built-in ink illustration (`client/src/ui/CardArt.tsx`). To use
painted art instead, make an image per card and drop it in `client/public/art/cards/`
named by the card's id (below), as `.png`, `.webp` or `.jpg`. Refresh the page: it
replaces that card's built-in drawing straight away, with no rebuild or restart. The
gallery (`/?gallery`, "Card art") shows which cards still use the built-in drawing.

**Size and shape.** Landscape, 10:7 (e.g. **1000×700**). It fills the card's art window
and is cropped from the centre, so keep the subject in the middle 70%. WebP or JPG at
~150 KB each keeps the whole set small.

**Keep the set consistent.** Use the same style block for every card and change only the
subject. Generate a few, pick the best, and keep the same seed or reference image across
the set if your tool supports it.

## Style block (prefix every prompt with this)

> Traditional Chinese ink-wash painting (shuimo) on warm rice paper, sumi ink with soft
> grey washes, misty distant mountains, generous empty space, one restrained vermilion
> accent, delicate dry-brush texture, calm and elegant, no text, no letters, no
> watermark, no border, landscape composition, subject centred.

Avoid: photorealism, 3D render, anime, bright saturated colour, modern objects, any
writing or seals with characters (the card already has its own seal and title).

## Cards

| id | card | subject (append to the style block) |
|---|---|---|
| `strike` | Strike | a straight sword slashing diagonally, a vermilion streak of motion behind the blade, small red sun |
| `dodge` | Dodge | a swirl of wind and silk ribbon where a figure has just stepped aside, an arrow passing harmlessly through, leaves scattering |
| `peach` | Peach | two ripe peaches with green leaves hanging from a gnarled branch |
| `ex_nihilo` | Something from Nothing | two blank cards appearing from a glowing ink circle (ensō) on empty paper, faint golden light |
| `dismantle` | Dismantle | an arched wooden bridge over a river, broken in the middle, planks falling, a vermilion snapped rope |
| `snatch` | Snatch | a white sheep being quietly led away on a red rope across a misty field |
| `duel` | Duel | two crossed swords before a large red sun |
| `barbarians` | Barbarian Invasion | a line of spears and red war banners advancing over jungle hills, palm fronds |
| `arrows` | Arrow Barrage | a volley of arrows raining diagonally across the sky over hills |
| `peach_garden` | Peach Garden | a peach tree in blossom with three peaches beside a small garden gate |
| `harvest` | Bountiful Harvest | golden sheaves of grain and a lacquered basket of peaches, red and green fruit, under a red sun |
| `borrowed_sword` | Borrowed Sword | a sword lying level in mid-air, a dashed vermilion line arcing from it to someone far away |
| `nullify` | Nullify | a thick brushed ink circle like a shield, an arrow glancing off it in a burst of vermilion |
| `indulgence` | Indulgence | a pavilion under a full moon, a wine jar and a red cup, the drinker gone, the evening forgotten |
| `lightning` | Lightning | a dark storm cloud with a golden lightning bolt striking down, rain |
| `crossbow` | Repeating Crossbow | a wooden repeating crossbow with a magazine of red-fletched bolts |
| `piercing_sword` | Piercing Sword | a straight sword standing point-up, its blade shining with pale light, red sun behind |
| `twin_swords` | Twin Swords | a matched pair of swords crossed point-down, red tassels |
| `frost_blade` | Frost Blade | a blue-steel sword in falling snow, ice crystals, cold pale-blue wash |
| `dragon_glaive` | Dragon Glaive | a crescent-bladed glaive on a long pole among swirling auspicious clouds, a hint of a jade dragon |
| `stone_axe` | Stone Axe | a heavy broad axe resting on a rock, chips of stone flying |
| `serpent_spear` | Serpent Spear | a long spear whose blade waves like a snake, red tassel |
| `halberd` | Sky Halberd | a halberd with crescent side blades against the sky, red sun |
| `kirin_bow` | Kirin Bow | a great bow fully drawn with an arrow nocked, auspicious clouds |
| `eight_trigrams` | Eight Trigrams | the eight trigrams in an octagon around a yin-yang, carved in dark wood |
| `benevolent_shield` | Benevolent Shield | a round dark shield with a gold rim and a red lotus at its centre |
| `plus_horse` | +1 Horse | a strong warhorse standing calm and guarded, red saddle cloth, red sun |
| `minus_horse` | −1 Horse | a warhorse at full gallop, speed lines of dry brush, red saddle cloth |

## Hero portraits (optional)

`client/public/art/heroes/<hero id>.png`, portrait 3:2 landscape (e.g. 900×600) with the
face in the centre. Use the same style block plus "portrait of <the hero>, a Three
Kingdoms-era general, half-length, dignified". Ids are in `/api/content` (`heroes`).
Without an image, each plaque shows the hero's brush character.
