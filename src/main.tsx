import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import App from "./App";
import { UnitsProvider } from "./components/Units";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UnitsProvider>
      <App />
    </UnitsProvider>
  </React.StrictMode>,
);
