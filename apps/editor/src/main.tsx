import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import "./styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Editor root element is missing");
}

type VisitStats = { pv: number; uv: number; scope: "all" };

const AnalyticsPage = lazy(() =>
  import("./components/analytics-page").then((module) => ({
    default: module.AnalyticsPage,
  })),
);

function Root() {
  const path = window.location.pathname;
  const [stats, setStats] = useState<VisitStats | null>(null);

  useEffect(() => {
    const analyticsHost =
      window.location.hostname === "analog-canvas.tokenzhang.com" ||
      window.location.hostname.endsWith(".workers.dev");
    if (
      !analyticsHost ||
      navigator.doNotTrack === "1" ||
      /^\/analytics\/?$/.test(path)
    ) {
      return;
    }
    let referrerOrigin = "";
    try {
      const referrer = new URL(document.referrer);
      if (/^https?:$/.test(referrer.protocol)) referrerOrigin = referrer.origin;
    } catch {
      // Direct visit or opaque referrer.
    }
    const source =
      new URLSearchParams(window.location.search)
        .get("utm_source")
        ?.trim()
        .toLowerCase()
        .slice(0, 40) ?? "";
    void fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      cache: "no-store",
      body: JSON.stringify({ p: path, r: referrerOrigin, s: source }),
    })
      .then(async (response) => {
        if (!response.ok || response.status === 204) return null;
        return response.json() as Promise<VisitStats>;
      })
      .then((value) => setStats(value))
      .catch(() => {
        // Analytics must never interfere with editor startup.
      });
  }, [path]);

  return /^\/analytics\/?$/.test(path) ? (
    <Suspense
      fallback={<div className="analytics-loading">Loading analytics…</div>}
    >
      <AnalyticsPage />
    </Suspense>
  ) : (
    <App visitStats={stats} />
  );
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    // Keep the worker inside Vite's base path so a repository Pages deployment
    // never installs a root-origin worker belonging to another site.
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  } else {
    void navigator.serviceWorker
      .getRegistrations()
      .then(async (registrations) => {
        if (registrations.length === 0) return;
        const wasControlled = navigator.serviceWorker.controller !== null;
        await Promise.all(
          registrations.map((registration) => registration.unregister()),
        );
        if (wasControlled) window.location.reload();
      });
  }
}
