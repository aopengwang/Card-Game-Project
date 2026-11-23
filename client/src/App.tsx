import { useEffect } from "react";
import { loadContent } from "./content";
import { getLang, t, useLang } from "./i18n";
import { resume, useNet } from "./net";
import { Home, Lobby } from "./components/Lobby";
import { Table, Toasts } from "./components/Table";

const roomFromUrl = new URLSearchParams(location.search).get("room");

export function App() {
  const net = useNet();
  const lang = useLang();
  useEffect(() => {
    loadContent();
    resume(roomFromUrl);
  }, []);
  useEffect(() => {
    document.documentElement.lang = getLang() === "zh" ? "zh-CN" : "en";
    document.title = t("app.title");
  }, [lang]);

  let screen: React.ReactNode;
  if (!net.session) {
    screen = <Home error={net.homeError} initialCode={roomFromUrl?.toUpperCase() ?? ""} />;
  } else if (!net.room) {
    screen = <div className="home muted">{t("app.connecting")}</div>;
  } else if (net.room.status !== "lobby" && net.view) {
    return <Table net={net} />;
  } else {
    screen = <Lobby net={net} />;
  }
  return (
    <>
      {screen}
      <Toasts toasts={net.toasts} />
    </>
  );
}
