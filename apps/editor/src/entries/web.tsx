import { lazy, StrictMode, Suspense, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";

import { useVisitStats } from "../../analytics/client";
import { EditorErrorBoundary } from "../components/editor-error-boundary";
import { guardedRouteChunk } from "../components/route-chunk-loader";
import {
  galleryFeedQueryKey,
  galleryQueryFromFilters,
  loadGalleryEntry,
  loadGalleryFeed,
  galleryTagScope,
  loadGalleryTagSummary,
  warmGalleryPreviews,
  type GalleryLandingPreload,
} from "../gallery-client";
import { earlyGalleryFetch } from "../gallery-early-fetch";
import { galleryOrderPreference, galleryShuffleSeed } from "../gallery-order";
import {
  GALLERY_FILTERS_KEY,
  isPageReload,
  resolveGalleryFilters,
} from "../gallery-filters";
import { galleryFocusEntryId } from "../gallery-focus";
import "../../analytics/analytics.css";
import "../styles.css";
import { hasAgentSessionRecovery } from "../agent/session-recovery-presence";

import type { WebEditorApp } from "./web-editor";
import { configureWebServiceWorker } from "./web-service-worker";
import { localhostExamplesEnabled } from "../gallery-source";
import { arenaEntryRedirect } from "../arena-entry-address";
import { isPhoneViewing } from "../phone-viewing";

export function mountWebEditor() {
  // A Schematic Arena "Draw it yourself" link opens its drawing in the
  // editor, and a sign-in begun there continues to it (#1695).
  const arenaEntryPath = arenaEntryRedirect(window.location);
  if (arenaEntryPath) {
    window.location.replace(arenaEntryPath);
    return;
  }
  // The Agent runtime is not part of the editor (#1673). A page that must
  // resume a saved session or pair automation loads it beside the route's
  // chunks, so the session is there as the page first renders. Its small
  // loader is itself loaded here, so the shell stays as it was.
  // A runtime that fails to load here does not hold up the editor: the
  // workspace provider tries again and shows the failure if it recurs.
  const agentRuntimeOnLoad = () =>
    import("../agent/agent-runtime-loader")
      .then((loader) => loader.loadAgentRuntimeNeededOnLoad())
      .catch(() => null);
  const WorkspaceAgentProvider = lazy(() =>
    guardedRouteChunk(() =>
      Promise.all([
        import("../agent/workspace-agent"),
        agentRuntimeOnLoad(),
      ]).then(([module]) => module),
    )().then((module) => ({
      default: module.WorkspaceAgentProvider,
    })),
  );
  const startPath = window.location.pathname;
  // `/editor` and `/g/<id>`: every path no other page claims.
  const editorRoute =
    !/^\/(?:analytics|moderation|privacy|account|mine)?\/?$/.test(startPath);
  // Unpaired Gallery visitors must not download the Editor/Agent runtime.
  // The editor routes load it with the editor; /privacy and a recovered
  // Agent session hold it above the page.
  const agentWorkspaceAbovePage =
    !editorRoute &&
    (/^\/privacy\/?$/.test(startPath) ||
      hasAgentSessionRecovery(window.sessionStorage));

  const container = document.getElementById("root");

  if (!container) {
    throw new Error("Editor root element is missing");
  }

  function galleryLandingPreload(): GalleryLandingPreload | undefined {
    if (!/^\/?$/.test(window.location.pathname) || localhostExamplesEnabled())
      return undefined;
    let storedFilters: string | null = null;
    try {
      storedFilters = localStorage.getItem(GALLERY_FILTERS_KEY);
    } catch {
      // An explicit URL filter still works when browser storage is disabled.
    }
    // Resolved as the wall resolves them, so a reload asks for the
    // unsearched wall it then opens (#1675).
    const filters = resolveGalleryFilters(
      window.location.search,
      storedFilters,
      { reload: isPageReload() },
    );
    // "View in Gallery" links one circuit on the whole, unfiltered wall.
    const focusId = galleryFocusEntryId(window.location.search);
    // The wall's first page starts here for the filters it will open with,
    // whether a link or a remembered choice sets them; a reader who once
    // narrowed the wall no longer waits for the wall's own code to ask.
    if (filters.view !== "gallery") return undefined;
    const query = galleryQueryFromFilters(filters, {
      // The order the wall opens with (#1615), and its shuffle.
      order: galleryOrderPreference(),
      seed: galleryShuffleSeed(),
    });
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
    ?.then((page) => {
      // The pending landing request can outlive a switch to Shelf. The URL
      // is the wall's shared current-view state, including Back navigation.
      if (
        /^\/?$/.test(window.location.pathname) &&
        resolveGalleryFilters(window.location.search, null).view === "gallery"
      )
        warmGalleryPreviews(page);
    })
    .catch(() => undefined);

  // The editor routes load the Agent workspace and the editor as one chunk
  // set behind one loading screen. Two nested lazy stages revealed a second
  // fallback, which React keeps for at least 300 ms though its code was
  // already preloaded (#1645).
  const EditorWorkspace = lazy(
    guardedRouteChunk(() =>
      Promise.all([
        import("../app/App"),
        import("./web-editor"),
        agentRuntimeOnLoad(),
      ]).then(([app, editor]) => ({
        default: function EditorRoute(
          props: ComponentProps<typeof WebEditorApp>,
        ) {
          return (
            <app.WorkspaceAgentProvider>
              <editor.WebEditorApp {...props} />
            </app.WorkspaceAgentProvider>
          );
        },
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
  const LocalExamplesPage = lazy(
    () => import("../components/local-examples-page"),
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

  // A phone views circuits and leaves drawing to a computer (2026-10-14).
  const PhoneCircuitPage = lazy(
    guardedRouteChunk(() =>
      import("../components/phone-circuit-page").then((module) => ({
        default: module.PhoneCircuitPage,
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
          {localhostExamplesEnabled() ? (
            <LocalExamplesPage visitStats={stats} />
          ) : (
            <GalleryFeed
              visitStats={stats}
              {...(initialGalleryPreload
                ? { preload: initialGalleryPreload }
                : {})}
            />
          )}
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
    if (isPhoneViewing())
      return (
        <Suspense fallback={<div className="analytics-loading">Loading…</div>}>
          <PhoneCircuitPage
            entryId={galleryEntryIdOf(path)}
            visitStats={stats}
          />
        </Suspense>
      );
    return (
      <Suspense
        fallback={<div className="analytics-loading">Loading editor…</div>}
      >
        <EditorWorkspace
          visitStats={stats}
          initialGalleryEntryId={galleryEntryIdOf(path)}
        />
      </Suspense>
    );
  }

  createRoot(container).render(
    <StrictMode>
      <EditorErrorBoundary>
        {agentWorkspaceAbovePage ? (
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
