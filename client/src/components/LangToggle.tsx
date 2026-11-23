import { LANGS, LANG_LABEL, setLang, useLang } from "../i18n";

/** Switches between English and 中文 (remembered in this browser). */
export function LangToggle() {
  const lang = useLang();
  const next = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
  return (
    <button type="button" className="lang-toggle" onClick={() => setLang(next)} title={LANG_LABEL[next]} lang={next === "zh" ? "zh-CN" : "en"}>
      {LANG_LABEL[next]}
    </button>
  );
}
