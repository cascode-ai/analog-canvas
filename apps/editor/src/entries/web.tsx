import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import { useVisitStats } from "../../analytics/client";
import { EditorErrorBoundary } from "../components/editor-error-boundary";
import { guardedRouteChunk } from "../components/route-chunk-loader";
import {
  galleryFeedQueryKey,
  loadGalleryEntry,
  loadGalleryFeed,
  galleryTagScope,
  loadGalleryTagSummary,
  warmGalleryPreviews,
  type GalleryLandingPreload,
} from "../gallery-client";
import { earlyGalleryFetch } from "../gallery-early-fetch";
import { GALLERY_FILTERS_KEY, resolveGalleryFilters } from "../gallery-filters";
import { galleryFocusEntryId } from "../gallery-focus";
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
    !/^\/(?:analytics|moderation|mine|account)?\/?$/.test(
      window.location.pathname,
    ) || hasAgentSessionRecovery(window.sessionStorage);

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
    // "View in Gallery" links one circuit on the whole, unfiltered wall.
    const focusId = galleryFocusEntryId(window.location.search);
    // The wall's first page starts here for the filters it will open with,
    // whether a link or a remembered choice sets them; a reader who once
    // narrowed the wall no longer waits for the wall's own code to ask.
    const query = {
      author: filters.author,
      ownerUserId: filters.ownerUserId,
      tags: filters.tags,
      netlistable: filters.netlistable,
      liked: filters.liked,
      attention: filters.attention,
      attentionKind: filters.attentionKind,
      parts: filters.parts,
    };
    // index.html already asked for the unfiltered wall's first page and
    // tags (#1592); the loaders take those answers when they ask the same.
    const early = earlyGalleryFetch();
    return {
      // The tags beside that page are counted for the same filters.
      tags: loadGalleryTagSummary(early, query),
      tagsScope: galleryTagScope(query),
      feed: loadGalleryFeed(early, { ...query, signedOutWall: true }),
      feedQuery: galleryFeedQueryKey(query),
      ...(focusId
        ? { focus: { id: focusId, entry: loadGalleryEntry(fetch, focusId) } }
        : {}),
    };
  }

  // Start public Gallery data beside the route chunk, before React mounts: the
  // first page and tag counts for the filters the wall opens with, and the
  // circuit a "View in Gallery" link names.
  const initialGalleryPreload = galleryLandingPreload();
  // Its first previews start when that page answers, not after the wall's
  // code has loaded and rendered the tiles (#1590).
  void initialGalleryPreload?.feed
    ?.then(warmGalleryPreviews)
    .catch(() => undefined);

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

  const AccountPage = lazy(
    guardedRouteChunk(() =>
      import("../components/account-page").then((module) => ({
        default: module.AccountPage,
      })),
    ),
  );

  const PrivacyPage = lazy(
    guardedRouteChunk(() =>
      import("../components/privacy-page").then((module) => ({
        default: module.PrivacyPage,
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
    // Readable signed out: it says what the site keeps before anyone signs in.
    if (/^\/privacy\/?$/.test(path)) {
      return (
        <Suspense
          fallback={<div className="analytics-loading">Loading privacy…</div>}
        >
          <PrivacyPage />
        </Suspense>
      );
    }
    if (/^\/account\/?$/.test(path)) {
      return (
        <Suspense
          fallback={<div className="analytics-loading">Loading account…</div>}
        >
          <AccountPage />
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
