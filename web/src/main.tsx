import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import "./index.css";

// HeroUI v3 is provider-free: components read theme vars off <html>, which
// index.html syncs to the OS light/dark preference before first paint.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/launcher">
      <App />
    </BrowserRouter>
  </StrictMode>
);
