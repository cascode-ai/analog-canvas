import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import { useVisitStats } from "../../analytics/client";
import { EditorErrorBoundary } from "../components/editor-error-boundary";
import { guardedRouteChunk } from "../components/route-chunk-loader";
import {
  loadGalleryFeed,
  galleryTagScope,
  loadGalleryTagSummary,
  type GalleryLandingPreload,
} from "../gallery-client";
import { GALLERY_FILTERS_KEY, resolveGalleryFilters } from "../gallery-filters";
import "../../analytics/analytics.css";
import "../styles.css";
import { hasAgentSessionRecovery } from "../agent/session-recovery-presence";

import { configureWebServiceWorker } from "./web-service-worker";

export function mountWebEditor() {
  const WorkspaceAgentProvider = lazy(() =>
    guardedRouteChunk(() => import("../app/App"))().then((module) => ({
      default: module.WorkspaceAgentProvider,
    })),
  );
  // Unpaired Gallery visitors must not download the Editor/Agent runtime.
  const needsAgentWorkspace =
    !/^\/(?:analytics|moderation|mine)?\/?$/.test(window.location.pathname) ||
    hasAgentSessionRecovery(window.sessionStorage);

  const container = document.getElementById("root");

  if (!container) {
    throw new Error("Editor root element is missing");
  }

  function galleryLandingPreload(): GalleryLandingPreload | undefined {
    if (!/^\/?$/.test(window.location.pathname)) return undefined;
    let storedFilters: string | null = null;
    try {
      storedFilters = localStorage.getItem(GALLERY_FILTERS_KEY);
    } catch {
      // An explicit URL filter still works when browser storage is disabled.
    }
    const filters = resolveGalleryFilters(
      window.location.search,
      storedFilters,
    );
    const tagFilters = {
      netlistable: filters.netlistable,
      liked: filters.liked,
      attention: filters.attention,
    };
    const tags = loadGalleryTagSummary(fetch, tagFilters);
    return {
      tags,
      tagsScope: galleryTagScope(tagFilters),
      ...(!window.location.search && !storedFilters
        ? { feed: loadGalleryFeed() }
        : {}),
    };
  }

  // Start public Gallery data beside the route chunk, before React mounts. A
  // remembered or linked filter still waits for GalleryFeed to request its exact
  // query; only the default wall reuses the unfiltered request.
  const initialGalleryPreload = galleryLandingPreload();

  const EditorApp = lazy(
    guardedRouteChunk(() =>
      import("./web-editor").then((module) => ({
        default: module.WebEditorApp,
      })),
    ),
  );

  const AnalyticsPage = lazy(
    guardedRouteChunk(() =>
      import("../../analytics/AnalyticsPage").then((module) => ({
        default: module.AnalyticsPage,
      })),
    ),
  );

  const GalleryFeed = lazy(
    guardedRouteChunk(() =>
      import("../components/gallery-feed").then((module) => ({
        default: module.GalleryFeed,
      })),
    ),
  );

  const Moderation = lazy(
    guardedRouteChunk(() =>
      import("../components/moderation").then((module) => ({
        default: module.Moderation,
      })),
    ),
  );

  const MySubmissions = lazy(
    guardedRouteChunk(() =>
      import("../components/my-submissions").then((module) => ({
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
    const stats = useVisitStats(path);

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
          <GalleryFeed
            visitStats={stats}
            {...(initialGalleryPreload
              ? { preload: initialGalleryPreload }
              : {})}
          />
        </Suspense>
      );
    }
    if (/^\/moderation\/?$/.test(path)) {
      return (
        <Suspense
          fallback={
            <div className="analytics-loading">Loading moderation…</div>
          }
        >
          <Moderation />
        </Suspense>
      );
    }
    if (/^\/mine\/?$/.test(path)) {
      return (
        <Suspense
          fallback={
            <div className="analytics-loading">Loading submissions…</div>
          }
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
        {needsAgentWorkspace ? (
          <Suspense
            fallback={
              <div className="analytics-loading">Loading workspace…</div>
            }
          >
            <WorkspaceAgentProvider>
              <Root />
            </WorkspaceAgentProvider>
          </Suspense>
        ) : (
          <Root />
        )}
      </EditorErrorBoundary>
    </StrictMode>,
  );

  void configureWebServiceWorker(
    import.meta.env.PROD,
    import.meta.env.BASE_URL,
  );
}
