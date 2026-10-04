import { initializeWorkspace } from "./lib/workspace";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

initializeWorkspace();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
