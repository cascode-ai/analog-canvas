import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { EditorErrorBoundary } from "./components/editor-error-boundary";
import "./styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Editor root element is missing");
}

type VisitStats = { pv: number; uv: number; scope: "all" };

/**
 * Load a route chunk, surviving a deploy that lands mid-session.
 *
 * Chunk names carry a content hash, so a page that has been open across a
 * deploy asks for names the current build no longer has. Reloading is the
 * whole remedy: `index.html` is served `must-revalidate` and the service
 * worker fetches navigations network-first, so the next document names the
 * assets that do exist.
 *
 * Exactly once per route per session. If the freshly loaded graph still
 * cannot produce the chunk, the failure is real and belongs in front of the
 * person rather than in a reload loop.
 */
const CHUNK_RELOAD_KEY = "icm-chunk-reload";

function rememberedReload(): string | null {
  try {
    return sessionStorage.getItem(CHUNK_RELOAD_KEY);
  } catch {
    // Private modes can refuse storage; then a reload is simply not retried.
    return window.location.pathname;
  }
}

function lazyChunk<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().then(
      (module) => {
        try {
          sessionStorage.removeItem(CHUNK_RELOAD_KEY);
        } catch {
          // Nothing to clear when storage is unavailable.
        }
        return module;
      },
      (error: unknown) => {
        if (rememberedReload() === window.location.pathname) throw error;
        try {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, window.location.pathname);
        } catch {
          // Without storage the guard cannot hold, so do not reload at all.
          throw error;
        }
        window.location.reload();
        // The reload replaces this document; nothing downstream should run.
        return new Promise<T>(() => {});
      },
    );
}

const EditorApp = lazy(
  lazyChunk(() =>
    import("./app/App").then((module) => ({
      default: module.App,
    })),
  ),
);

const AnalyticsPage = lazy(
  lazyChunk(() =>
    import("./components/analytics-page").then((module) => ({
      default: module.AnalyticsPage,
    })),
  ),
);

const GalleryFeed = lazy(
  lazyChunk(() =>
    import("./components/gallery-feed").then((module) => ({
      default: module.GalleryFeed,
    })),
  ),
);

const Moderation = lazy(
  lazyChunk(() =>
    import("./components/moderation").then((module) => ({
      default: module.Moderation,
    })),
  ),
);

const MySubmissions = lazy(
  lazyChunk(() =>
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
        <GalleryFeed />
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
