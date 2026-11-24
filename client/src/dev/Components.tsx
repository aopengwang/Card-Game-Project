// Gallery: every Ink & Lacquer component in each of its states (developer tool).
import { useState } from "react";
import { ActionBar } from "../components/ActionBar";
import { EMPTY } from "../selection";
import type { Card as CardData, PlayerView } from "../types";
import { Beads, RoleSeal, TimerRing } from "../ui/Bits";
import { Button, SealButton } from "../ui/Button";
import { Card, CardBack } from "../ui/Card";
import { Plaque } from "../ui/Plaque";
import { useArtManifest } from "../art";
import { useContent } from "../content";
import { FIXTURES, fixtureNet } from "./fixtures";
import s from "./Gallery.module.css";

const card = (id: number, name: string, suit: CardData["suit"], rank: number): CardData => ({ id, name, suit, rank });

const CARDS: [string, CardData][] = [
  ["Basic", card(1, "strike", "spade", 7)],
  ["Basic, red", card(2, "peach", "heart", 8)],
  ["Trick", card(3, "nullify", "club", 12)],
  ["Delayed trick", card(4, "lightning", "spade", 1)],
  ["Equipment", card(5, "eight_trigrams", "spade", 2)],
  ["Converted", { id: -1, name: "strike", suit: "none", rank: 0, virtual: true, color: "black" }],
];

/** A sample seat built from a real fixture player, with overrides per state. */
function samplePlayer(over: Partial<PlayerView>): PlayerView {
  const base = FIXTURES.find((f) => f.id === "eight_players")!.view.players.find((p) => p.alive && p.equips.length > 0)!;
  return { ...base, ...over };
}

/**
 * Every card's art, with where it comes from: your image (client/public/art/cards) or the
 * built-in ink scene. The checklist for anyone adding painted art (docs/art-prompts.md).
 */
function ArtShowcase() {
  const content = useContent();
  const art = useArtManifest();
  const names = Object.keys(content.cards);
  const custom = names.filter((n) => art.cards[n]).length;
  return (
    <section className={s.section} aria-labelledby="art">
      <span id="art" className={s.label}>
        Card art · {custom}/{names.length} with your own image
      </span>
      <div className={s.row}>
        {names.map((name, i) => (
          <figure key={name} className={s.figure}>
            <Card card={card(100 + i, name, i % 2 ? "heart" : "spade", (i % 13) + 1)} size="lg" />
            <figcaption className={`${s.caption} art-source`}>
              {name}
              <br />
              {art.cards[name] ? "your image" : "built-in"}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

export function ComponentsShowcase() {
  const [deadline] = useState(() => Date.now() + 40_000);
  const [lowDeadline] = useState(() => Date.now() + 6_000);
  const promptFixtures = ["play_skill", "respond_dodge", "nullify_chain", "confirm_armor", "choose_card"];
  return (
    <>
      <section className={s.section} aria-labelledby="cards">
        <span id="cards" className={s.label}>Cards</span>
        <div className={s.row}>
          {CARDS.map(([label, c]) => (
            <figure key={label} className={s.figure}>
              <Card card={c} />
              <figcaption className={s.caption}>{label}</figcaption>
            </figure>
          ))}
          <figure className={s.figure}>
            <CardBack />
            <figcaption className={s.caption}>Back</figcaption>
          </figure>
        </div>
        <div className={s.row}>
          <figure className={s.figure}><Card card={CARDS[0][1]} clickable onClick={() => {}} /><figcaption className={s.caption}>Playable</figcaption></figure>
          <figure className={s.figure}><Card card={CARDS[0][1]} clickable selected onClick={() => {}} /><figcaption className={s.caption}>Selected</figcaption></figure>
          <figure className={s.figure}><Card card={CARDS[0][1]} dim /><figcaption className={s.caption}>Not playable now</figcaption></figure>
          <figure className={s.figure}><Card card={CARDS[2][1]} size="sm" /><figcaption className={s.caption}>Small</figcaption></figure>
          <figure className={s.figure}><Card card={CARDS[4][1]} size="lg" /><figcaption className={s.caption}>Large</figcaption></figure>
        </div>
      </section>

      <ArtShowcase />

      <section className={s.section} aria-labelledby="plaques">
        <span id="plaques" className={s.label}>Seat plaques</span>
        <div className={s.row}>
          {[
            ["Default", {}, {}],
            ["Current turn", {}, { isCurrent: true }],
            ["Waiting on them", {}, { isWaitedOn: true }],
            ["Can be targeted", {}, { clickable: true }],
            ["Selected target", { role: "lord" }, { selected: true }],
            ["Dying", { hp: 0 }, {}],
            ["Fallen", { alive: false, hp: 0, role: "loyalist" }, {}],
          ].map(([label, over, state]) => (
            <figure key={label as string} className={s.figure} style={{ width: 160 }}>
              <Plaque player={samplePlayer(over as Partial<PlayerView>)} name="Lin" {...(state as object)} onClick={() => {}} />
              <figcaption className={s.caption}>{label as string}</figcaption>
            </figure>
          ))}
          <figure className={s.figure} style={{ width: 232 }}>
            <Plaque player={samplePlayer({ role: "rebel" })} name="Mei" variant="self" isYou isCurrent />
            <figcaption className={s.caption}>Your seat</figcaption>
          </figure>
        </div>
      </section>

      <section className={s.section} aria-labelledby="pieces">
        <span id="pieces" className={s.label}>Seals, HP, timer, buttons</span>
        <div className={s.row}>
          {["lord", "loyalist", "rebel", "spy", null].map((r) => (
            <RoleSeal key={r ?? "hidden"} role={r} size="lg" onDark />
          ))}
          <Beads hp={4} max={4} size="lg" />
          <Beads hp={2} max={4} size="lg" />
          <Beads hp={0} max={3} size="lg" dying />
          <TimerRing deadline={deadline} total={45_000} />
          <TimerRing deadline={lowDeadline} total={45_000} />
        </div>
        <div className={s.row}>
          <Button variant="primary">Use</Button>
          <Button>Cancel</Button>
          <Button variant="ghost">End play phase</Button>
          <Button shape="pill">中文</Button>
          <SealButton char="令" label="Iron Edict" />
          <SealButton char="船" label="Burning Fleet" active />
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
      </section>

      <section className={s.section} aria-labelledby="prompts">
        <span id="prompts" className={s.label}>Prompt banner (real requests)</span>
        <div className={s.stack}>
          {promptFixtures.map((id) => {
            const fx = FIXTURES.find((f) => f.id === id);
            if (!fx) return null;
            const net = fixtureNet(fx);
            const name = (seat: number | null | undefined) => (seat == null ? "?" : fx.room.members[seat]?.name ?? `P${seat}`);
            return <ActionBar key={id} request={net.request} view={fx.view} sel={EMPTY} setSel={() => {}} name={name} waitingText="" />;
          })}
          <ActionBar request={null} view={FIXTURES[0].view} sel={EMPTY} setSel={() => {}} name={() => ""} waitingText="Waiting for Kai to play…" />
        </div>
      </section>
    </>
  );
}
