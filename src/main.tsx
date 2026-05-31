import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { QuickAddStandalone } from "./QuickAddStandalone";
import "./styles.css";

const RootComponent = window.location.pathname === "/quick-add" ? QuickAddStandalone : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>,
);
