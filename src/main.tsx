import { render } from "preact";
import { QueryClientProvider } from "@tanstack/preact-query";
import { App, qc } from "./features/trips/App";
import "./style.css";
render(
  <QueryClientProvider client={qc}>
    <App />
  </QueryClientProvider>,
  document.getElementById("app")!,
);
