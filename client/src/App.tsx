import { useEffect } from "react";
import { loadContent } from "./content";
import { resume, useNet } from "./net";
import { Home, Lobby } from "./components/Lobby";
import { Table, Toasts } from "./components/Table";

const roomFromUrl = new URLSearchParams(location.search).get("room");

export function App() {
  const net = useNet();
  useEffect(() => {
    loadContent();
    resume(roomFromUrl);
  }, []);

  let screen: React.ReactNode;
  if (!net.session) {
    screen = <Home error={net.homeError} initialCode={roomFromUrl?.toUpperCase() ?? ""} />;
  } else if (!net.room) {
    screen = <div className="home muted">Connecting…</div>;
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
