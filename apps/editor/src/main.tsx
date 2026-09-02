import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { EditorErrorBoundary } from "./components/editor-error-boundary";
import { guardedRouteChunk } from "./components/route-chunk-loader";
import "./styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Editor root element is missing");
}

type VisitStats = { pv: number; uv: number; scope: "all" };

const EditorApp = lazy(
  guardedRouteChunk(() =>
    import("./app/App").then((module) => ({
      default: module.App,
    })),
  ),
);

const AnalyticsPage = lazy(
  guardedRouteChunk(() =>
    import("./components/analytics-page").then((module) => ({
      default: module.AnalyticsPage,
    })),
  ),
);

const GalleryFeed = lazy(
  guardedRouteChunk(() =>
    import("./components/gallery-feed").then((module) => ({
      default: module.GalleryFeed,
    })),
  ),
);

const Moderation = lazy(
  guardedRouteChunk(() =>
    import("./components/moderation").then((module) => ({
      default: module.Moderation,
    })),
  ),
);

const MySubmissions = lazy(
  guardedRouteChunk(() =>
    import("./components/my-submissions").then((module) => ({
      default: module.MySubmissions,
    })),
  ),
);

/** `/` is the gallery, `/editor` the editor, `/g/<id>` one gallery entry. */
function galleryEntryIdOf(path: string): string | null {
  const match = /^\/g\/([A-Za-z0-9-]{1,64})\/?$/.exec(path);
  return match ? match[1]! : null;
}

function Root() {
  const path = window.location.pathname;
  const [stats, setStats] = useState<VisitStats | null>(null);

  useEffect(() => {
    const analyticsHost =
      window.location.hostname === "analog-canvas.tokenzhang.com" ||
      window.location.hostname.endsWith(".workers.dev");
    if (!analyticsHost || /^\/analytics\/?$/.test(path)) {
      return;
    }
    // The statusbar readout is a public counter, not tracking: it loads for
    // every visitor — Do Not Track included — and never depends on whether
    // the beacon below chose to report.
    void fetch("/api/stats", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? ((await response.json()) as VisitStats) : null,
      )
      .then((value) => {
        if (value) setStats(value);
      })
      .catch(() => {
        // Analytics must never interfere with editor startup.
      });
    if (navigator.doNotTrack === "1") return;
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
    }).catch(() => {
      // The beacon is fire-and-forget.
    });
  }, [path]);

  if (/^\/analytics\/?$/.test(path)) {
    return (
      <Suspense
        fallback={<div className="analytics-loading">Loading analytics…</div>}
      >
        <AnalyticsPage />
      </Suspense>
    );
  }
  if (/^\/?$/.test(path)) {
    return (
      <Suspense
        fallback={<div className="analytics-loading">Loading gallery…</div>}
      >
        <GalleryFeed visitStats={stats} />
      </Suspense>
    );
  }
  if (/^\/moderation\/?$/.test(path)) {
    return (
      <Suspense
        fallback={<div className="analytics-loading">Loading moderation…</div>}
      >
        <Moderation />
      </Suspense>
    );
  }
  if (/^\/mine\/?$/.test(path)) {
    return (
      <Suspense
        fallback={<div className="analytics-loading">Loading submissions…</div>}
      >
        <MySubmissions />
      </Suspense>
    );
  }
  return (
    <Suspense
      fallback={<div className="analytics-loading">Loading editor…</div>}
    >
      <EditorApp
        visitStats={stats}
        initialGalleryEntryId={galleryEntryIdOf(path)}
      />
    </Suspense>
  );
}

createRoot(container).render(
  <StrictMode>
    <EditorErrorBoundary>
      <Root />
    </EditorErrorBoundary>
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
