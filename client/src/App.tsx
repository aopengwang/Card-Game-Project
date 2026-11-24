import { Suspense, lazy, useEffect } from "react";
import { loadContent } from "./content";
import { getLang, t, useLang } from "./i18n";
import { resume, useNet } from "./net";
import { Home, Lobby } from "./components/Lobby";
import { Table, Toasts } from "./components/Table";

const params = new URLSearchParams(location.search);
const roomFromUrl = params.get("room");
const galleryFixture = params.get("gallery"); // developer gallery: /?gallery[=fixture]
const fxLab = params.get("fx"); // animation lab: /?fx[=effect]

// Loaded on demand so fixtures never ship in the game's main bundle.
const Gallery = lazy(() => import("./dev/Gallery"));
const FxLab = lazy(() => import("./dev/FxLab"));

export function App() {
  const net = useNet();
  const lang = useLang();
  useEffect(() => {
    loadContent();
    if (galleryFixture === null && fxLab === null) resume(roomFromUrl);
  }, []);
  useEffect(() => {
    document.documentElement.lang = getLang() === "zh" ? "zh-CN" : "en";
    document.title = t("app.title");
  }, [lang]);

  if (fxLab !== null) {
    return (
      <Suspense fallback={null}>
        <FxLab initial={fxLab} />
      </Suspense>
    );
  }
  if (galleryFixture !== null) {
    return (
      <Suspense fallback={null}>
        <Gallery fixture={galleryFixture} />
      </Suspense>
    );
  }

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
