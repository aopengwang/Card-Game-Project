import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TipProvider } from "./ui/Tip";
import { initScale } from "./uiScale";
import "./styles/tokens.css";
import "./styles.css";

initScale(); // interface size (Settings): before the first paint

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TipProvider>
      <App />
    </TipProvider>
  </StrictMode>,
);
