// Component gallery (developer tool): open with /?gallery, or /?gallery=<fixture id>&lang=zh
// to see one real captured game state rendered by the real table UI.
import { useContent } from "../content";
import { LangToggle } from "../components/LangToggle";
import { Table } from "../components/Table";
import { useLang } from "../i18n";
import { FIXTURES, fixtureNet } from "./fixtures";
import s from "./Gallery.module.css";

const SWATCHES: [string, string][] = [
  ["Lacquer", "lacquer"], ["Ember", "ember"], ["Panel", "panel"], ["Rice paper", "paper"],
  ["Ink", "ink"], ["Vermilion", "vermilion"], ["Lamp gold", "gold"], ["Jade", "jade"],
  ["Wei", "wei"], ["Shu", "shu"], ["Wu", "wu"], ["Qun", "qun"],
  ["Basic band", "band-basic"], ["Trick band", "band-trick"], ["Equipment band", "band-equipment"],
];

export default function Gallery({ fixture }: { fixture: string }) {
  useLang();
  useContent();
  if (fixture) {
    const fx = FIXTURES.find((f) => f.id === fixture);
    if (fx) return <Table net={fixtureNet(fx)} />;
    return (
      <div className={s.page}>
        <p className={s.missing}>Unknown fixture “{fixture}”.</p>
        <a className={s.link} href="?gallery">Back to the gallery</a>
      </div>
    );
  }
  return <GalleryIndex />;
}

function GalleryIndex() {
  const lang = useLang();
  return (
    <main className={s.page}>
      <div className={s.inner}>
        <div className={s.head}>
          <h1 className={s.title}>
            Component gallery<span className={s.brush} lang="zh-CN">墨与漆</span>
          </h1>
          <LangToggle />
        </div>
        <p className={s.lede}>
          Ink &amp; Lacquer foundations, and real game moments captured from hard-bot games
          (<code>python -m tools.dump_fixtures</code>), each rendered by the live table UI.
          Open one at any window size; the language toggle applies to all of them.
        </p>

        <section className={s.section} aria-labelledby="palette">
          <span id="palette" className={s.label}>Palette</span>
          <div className={s.swatches}>
            {SWATCHES.map(([name, token]) => (
              <div key={token} className={s.swatch}>
                <div className={s.chip} style={{ background: `var(--ik-${token})` }} />
                <span className={s.swatchName}>{name}</span>
                <span className={s.swatchVar}>--ik-{token}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={s.section} aria-labelledby="type">
          <span id="type" className={s.label}>Type (switches with the language)</span>
          <div className={s.specimens}>
            <div className={s.specimen}>
              <span style={{ font: "700 var(--ik-text-2xl) var(--ik-font-display)", color: "var(--ik-text-strong)" }}>
                {lang === "zh" ? "选择你的武将" : "Choose your hero"}
              </span>
              <span className={s.caption}>Display · --ik-font-display</span>
            </div>
            <div className={s.specimen}>
              <span style={{ font: "400 var(--ik-text-md)/1.6 var(--ik-font-body)", color: "var(--ik-text)" }}>
                {lang === "zh"
                  ? "出牌阶段限一次：对攻击范围内的一名角色使用。"
                  : "Once per turn: target a player in your attack range."}
              </span>
              <span className={s.caption}>Body · --ik-font-body</span>
            </div>
            <div className={s.specimen}>
              <span style={{ font: "var(--ik-text-3xl)/1 var(--ik-font-brush)", color: "var(--ik-vermilion-bright)" }} lang="zh-CN">
                主公阵亡
              </span>
              <span className={s.caption}>Brush · --ik-font-brush (titles, banners)</span>
            </div>
          </div>
        </section>

        <section className={s.section} aria-labelledby="fixtures">
          <span id="fixtures" className={s.label}>Game moments ({FIXTURES.length})</span>
          <div className={s.fixtures}>
            {FIXTURES.map((fx) => (
              <div key={fx.id} className={s.fixture}>
                <span className={s.fixtureTitle}>{fx.title}</span>
                <span className={s.fixtureMeta}>
                  {fx.players} players · {fx.request ? `asks: ${fx.request.req.kind}` : fx.view.result ? "finished" : "waiting"} · seed {fx.seed}
                </span>
                <div className={s.links}>
                  <a className={s.link} href={`?gallery=${fx.id}&lang=en`}>English</a>
                  <a className={s.link} href={`?gallery=${fx.id}&lang=zh`} lang="zh-CN">中文</a>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
