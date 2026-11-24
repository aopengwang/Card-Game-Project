import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TipProvider } from "./ui/Tip";
import { initScale } from "./uiScale";
import { loadArt } from "./art";
import { initSound } from "./sound";
import "./styles/tokens.css";
import "./styles.css";

initScale(); // interface size (Settings): before the first paint
void loadArt(); // which card/hero images exist (built-in ink art otherwise)
initSound(); // table sounds start on the first click or key press (browser rule)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TipProvider>
      <App />
    </TipProvider>
  </StrictMode>,
);
