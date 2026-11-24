import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TipProvider } from "./ui/Tip";
import "./styles/tokens.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TipProvider>
      <App />
    </TipProvider>
  </StrictMode>,
);
