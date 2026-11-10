import { lazy, StrictMode, Suspense, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";

import { useVisitStats } from "../../analytics/client";
import { EditorErrorBoundary } from "../components/editor-error-boundary";
import { guardedRouteChunk } from "../components/route-chunk-loader";
import { AccountStatePreload, loadAccountState } from "../components/account";
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
import {
  forgetSaveOnSignIn,
  saveAfterSignInRedirect,
  settleSaveOnEditorOpen,
} from "../document/save-after-sign-in";
import { requestSignIn } from "../components/sign-in-request";
import { isPhoneViewing } from "../phone-viewing";
import { galleryEntryIdOfPath, isEditorPath } from "../page-routes";
import {
  GalleryEntryGate,
  galleryEntryPresence,
} from "../components/gallery-entry-gate";

export function mountWebEditor() {
  // A Schematic Arena "Draw it yourself" link opens its drawing in the
  // editor, and a sign-in begun there continues to it (#1695).
  const arenaEntryPath = arenaEntryRedirect(window.location);
  if (arenaEntryPath) {
    window.location.replace(arenaEntryPath);
    return;
  }
  // A GitHub or Google sign-in begun from a signed-out Save ends here, on
  // the Gallery: the editor's tabs resume and the Save continues, or the
  // editor says the sign-in failed (#2161).
  const savePath = saveAfterSignInRedirect(window.location);
  if (savePath) {
    window.location.replace(savePath);
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
  // `/editor` and `/g/<id>`; a path no page serves is none of them (#2159).
  const editorRoute = isEditorPath(startPath);
  // A sign-in begun from a Save has ended once the editor opens; one that
  // failed says so in the sign-in choices, and the Save is pressed again.
  if (editorRoute && settleSaveOnEditorOpen(window.location).signInFailed)
    requestSignIn();
  // Back from a provider the person left unchosen: that Save will not run.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) forgetSaveOnSignIn();
  });
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

  // Start both account reads beside the editor's download. The menu receives
  // this same promise even if the response arrives before its code does.
  const initialAccountState =
    editorRoute && !isPhoneViewing() ? loadAccountState() : null;

  function galleryLandingPreload(): GalleryLandingPreload | undefined {
    if (!/^\/?$/.test(window.location.pathname) || localhostExamplesEnabled())
      return undefined;
    let storedFilters: string | null = null;
    try {
      storedFilters = sessionStorage.getItem(GALLERY_FILTERS_KEY);
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
      feed: loadGalleryFeed(early, query),
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
  const loadEditorWorkspace = guardedRouteChunk(() =>
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
  );
  // On the editor's routes the download starts now, beside a `/g/<id>`
  // link's presence check, not once the check has answered (#2159).
  const editorWorkspaceChunk =
    editorRoute && !isPhoneViewing() ? loadEditorWorkspace() : null;
  // React reads it later; a failure is its to show, not an unhandled one.
  editorWorkspaceChunk?.catch(() => {});
  const EditorWorkspace = lazy(
    () => editorWorkspaceChunk ?? loadEditorWorkspace(),
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

  const DatasetsPage = lazy(
    guardedRouteChunk(() =>
      import("../components/datasets-page").then((module) => ({
        default: module.DatasetsPage,
      })),
    ),
  );

  const ReviewPage = lazy(
    guardedRouteChunk(() =>
      import("../components/review-page").then((module) => ({
        default: module.ReviewPage,
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

  const ChangeLogPage = lazy(
    guardedRouteChunk(() =>
      import("../components/change-log-page").then((module) => ({
        default: module.ChangeLogPage,
      })),
    ),
  );

  const GalleryEntryMissing = lazy(
    guardedRouteChunk(() =>
      import("../components/missing-page").then((module) => ({
        default: module.GalleryEntryMissing,
      })),
    ),
  );

  const PageNotFound = lazy(
    guardedRouteChunk(() =>
      import("../components/missing-page").then((module) => ({
        default: module.PageNotFound,
      })),
    ),
  );

  // A `/g/<id>` link on a computer asks, beside the editor's download
  // started above, whether the Gallery holds that circuit (#2159).
  const startEntryId = galleryEntryIdOfPath(startPath);
  const startEntryPresence =
    startEntryId && !isPhoneViewing()
      ? galleryEntryPresence(fetch, startEntryId)
      : null;

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
              filingNumber={
                document.querySelector<HTMLMetaElement>(
                  'meta[name="canvas-icp-filing"]',
                )?.content
              }
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
    if (/^\/changelog\/?$/.test(path)) {
      return (
        <Suspense
          fallback={
            <div className="analytics-loading">Loading the change log…</div>
          }
        >
          <ChangeLogPage />
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
    if (/^\/datasets\/?$/.test(path)) {
      return (
        <Suspense
          fallback={<div className="analytics-loading">Loading datasets…</div>}
        >
          <DatasetsPage visitStats={stats} />
        </Suspense>
      );
    }
    if (/^\/review\/?$/.test(path)) {
      return (
        <Suspense
          fallback={<div className="analytics-loading">Loading review…</div>}
        >
          <ReviewPage visitStats={stats} />
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
    // Every other path is no page: the Worker answers it with 404 first,
    // so this shows only where no Worker runs (#2159).
    if (!editorRoute)
      return (
        <Suspense fallback={<div className="analytics-loading">Loading…</div>}>
          <PageNotFound visitStats={stats} />
        </Suspense>
      );
    if (isPhoneViewing())
      return (
        <Suspense fallback={<div className="analytics-loading">Loading…</div>}>
          <PhoneCircuitPage
            entryId={galleryEntryIdOfPath(path)}
            visitStats={stats}
          />
        </Suspense>
      );
    return (
      <GalleryEntryGate
        presence={startEntryPresence}
        missing={
          <Suspense
            fallback={<div className="analytics-loading">Loading…</div>}
          >
            <GalleryEntryMissing visitStats={stats} />
          </Suspense>
        }
      >
        <Suspense
          fallback={<div className="analytics-loading">Loading editor…</div>}
        >
          <AccountStatePreload value={initialAccountState}>
            <EditorWorkspace
              visitStats={stats}
              initialGalleryEntryId={galleryEntryIdOfPath(path)}
            />
          </AccountStatePreload>
        </Suspense>
      </GalleryEntryGate>
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
