import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AccessGate } from "./components/AccessGate";
import { AdmissionGate } from "./components/AccessLinks/AdmissionGate";
import { consumeAccessLink } from "./lib/accessLink";
import "./theme.css";

// A temp access link drops the secret + target room in the URL. Ingest it (token → localStorage,
// room → sessionStorage) and strip the params BEFORE first render, so AccessGate's probe is authed
// and the secret never lingers in the address bar.
consumeAccessLink();

const qc = new QueryClient();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}><AccessGate><AdmissionGate><App /></AdmissionGate></AccessGate></QueryClientProvider>
  </React.StrictMode>
);
