// Publishing to the Gallery: the signed-in account and its Cloud Projects,
// the Publish dialog's state, the link to an existing entry, and what a
// publication leaves behind.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  evaluateSubmissionGates,
  type SubmissionGateReport,
} from "@icm/derived";
import type { CircuitProject } from "@icm/model";
import type { SessionUser } from "../components/account";
import type {
  EditorDocumentController,
  useDocumentController,
} from "../document/document-controller";
import type { useProjectFileLifecycle } from "../document/use-project-file-lifecycle";
import type { CloudProjectSummary } from "../features/editor-shell/cloud-projects";
import type { GalleryEntryContext } from "../features/editor-shell/gallery-example-commands";
import {
  canUpdateGalleryPublication,
  loadGalleryPublicationContext,
  loadGalleryQuota,
  type GalleryPublicationRecord,
  type GalleryQuota,
} from "../features/editor-shell/gallery-publish";
import type { GalleryPublishedNoticeState } from "../features/editor-shell/gallery-published-notice";
import {
  announceGalleryChange,
  primeGalleryPreview,
  subscribeGalleryRefresh,
  type GalleryDailyOpenLimit,
} from "../gallery-client";
import type { EditorServices } from "../services/editor-services";
import type { useAgentProjectResources } from "./use-agent-hosts";

type DocumentControllerState = ReturnType<typeof useDocumentController>;
type ProjectFileLifecycle = ReturnType<typeof useProjectFileLifecycle>;
type AgentProjectResources = ReturnType<typeof useAgentProjectResources>;
type GalleryRefresh = ReturnType<typeof useGalleryRefresh>;
type GalleryPublishing = ReturnType<typeof useGalleryPublishing>;

/** Refreshes the Gallery panel while it is open and the wall changes. */
export function useGalleryRefresh({
  capabilities,
  visibleLibraryPanelOpen,
}: {
  capabilities: EditorServices["capabilities"];
  visibleLibraryPanelOpen: boolean;
}) {
  const [, setGalleryRefreshSignal] = useState(0);
  const galleryLoadGenerationRef = useRef(0);
  useEffect(() => {
    if (!capabilities.community || !visibleLibraryPanelOpen) return;
    return subscribeGalleryRefresh(() => {
      galleryLoadGenerationRef.current += 1;
      setGalleryRefreshSignal((previous) => previous + 1);
    });
  }, [capabilities.community, visibleLibraryPanelOpen]);
  return { setGalleryRefreshSignal, galleryLoadGenerationRef };
}

/** The account that publishes, its Cloud Projects, and the Publish dialog. */
export function useGalleryPublishing({
  identity,
  projectStore,
  project,
  resolver,
}: {
  identity: EditorServices["identity"];
  projectStore: EditorServices["projectStore"];
  project: CircuitProject;
  resolver: DocumentControllerState["resolver"];
}) {
  const [publishGalleryOpen, setPublishGalleryOpen] = useState(false);
  // Opened from the duplicate check's notice, which asks for that check's
  // results whatever circuit it checked (#1417).
  const [openedFromCheckNotice, setOpenedFromCheckNotice] = useState(false);
  const [publishedNotice, setPublishedNotice] =
    useState<GalleryPublishedNoticeState | null>(null);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [galleryDailyLimit, setGalleryDailyLimit] =
    useState<GalleryDailyOpenLimit | null>(null);
  const [publishSession, setPublishSession] = useState<SessionUser | null>(
    null,
  );
  /** The signed-in account's private formal Projects, newest first. */
  const [cloudProjects, setCloudProjects] = useState<
    readonly CloudProjectSummary[]
  >([]);
  const [cloudProjectsReady, setCloudProjectsReady] = useState(false);
  const cloudListRequestRef = useRef(0);
  const cloudListMutationRef = useRef(0);
  const reloadCloudProjects = useCallback(async (): Promise<void> => {
    if (!projectStore) {
      setCloudProjectsReady(true);
      return;
    }
    const request = ++cloudListRequestRef.current;
    const mutationAtStart = cloudListMutationRef.current;
    const outcome = await projectStore.list();
    if (request !== cloudListRequestRef.current) return;
    setCloudProjectsReady(true);
    if (outcome.status !== "listed") return;
    // A Save or Delete acknowledged after this request began is newer than
    // the response, so the stale list must not erase that mutation.
    if (mutationAtStart !== cloudListMutationRef.current) return;
    setCloudProjects(outcome.projects);
  }, [projectStore]);
  const [galleryEntryContext, setGalleryEntryContext] =
    useState<GalleryEntryContext | null>(null);
  const [publicationLinkLoading, setPublicationLinkLoading] = useState(false);
  const [publicationLinkError, setPublicationLinkError] = useState<
    string | null
  >(null);
  const [publicationLinkNotice, setPublicationLinkNotice] = useState<
    string | null
  >(null);
  const [publicationLinkRetry, setPublicationLinkRetry] = useState(0);
  // The moment any OTHER Project replaces the opened gallery entry (new
  // circuit, bundled example, import, …), the update offer must vanish —
  // otherwise a later publish silently overwrites the stale entry.
  const activeProjectId = project.id;
  useEffect(() => {
    setGalleryEntryContext((previous) =>
      previous && previous.projectId !== activeProjectId ? null : previous,
    );
  }, [activeProjectId]);
  // The Examples panel reads the same community gallery as the landing
  // feed; null means unreachable, so the bundled list stands in.
  const [publishGates, setPublishGates] = useState<SubmissionGateReport | null>(
    null,
  );
  // Account state owns publishing authority and the private Cloud Project
  // list shown by the File menu.
  useEffect(() => {
    let cancelled = false;
    if (!identity) return;
    void identity.getSessionUser().then(async (user) => {
      if (cancelled) return;
      setPublishSession(user);
      if (!user) {
        setCloudProjectsReady(true);
        return;
      }
      await reloadCloudProjects();
    });
    return () => {
      cancelled = true;
    };
  }, [identity, reloadCloudProjects]);

  useEffect(() => {
    if (!publishSession) return;
    const refreshAfterReturning = () => void reloadCloudProjects();
    window.addEventListener("focus", refreshAfterReturning);
    return () => window.removeEventListener("focus", refreshAfterReturning);
  }, [publishSession, reloadCloudProjects]);

  const [publishQuota, setPublishQuota] = useState<GalleryQuota | null>(null);
  // What the account may still publish today, read each time the dialog opens.
  const publishAccountId = publishSession?.id ?? null;
  useEffect(() => {
    // An earlier count is no promise for this opening: say nothing until read.
    setPublishQuota(null);
    if (!publishGalleryOpen || !publishAccountId) return;
    let cancelled = false;
    void loadGalleryQuota().then((quota) => {
      if (!cancelled) setPublishQuota(quota);
    });
    return () => {
      cancelled = true;
    };
  }, [publishGalleryOpen, publishAccountId]);
  useEffect(() => {
    if (!publishGalleryOpen) return;
    let cancelled = false;
    if (!identity) return;
    void identity.getSessionUser().then((user) => {
      if (!cancelled) setPublishSession(user);
    });
    // The same evaluator the worker enforces, run live on the open Project.
    setPublishGates(evaluateSubmissionGates(project, resolver));
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- evaluated once per dialog open
  }, [identity, publishGalleryOpen]);
  return {
    publishGalleryOpen,
    setPublishGalleryOpen,
    openedFromCheckNotice,
    setOpenedFromCheckNotice,
    publishedNotice,
    setPublishedNotice,
    versionHistoryOpen,
    setVersionHistoryOpen,
    galleryDailyLimit,
    setGalleryDailyLimit,
    publishSession,
    cloudProjects,
    setCloudProjects,
    cloudProjectsReady,
    cloudListMutationRef,
    reloadCloudProjects,
    galleryEntryContext,
    setGalleryEntryContext,
    publicationLinkLoading,
    setPublicationLinkLoading,
    publicationLinkError,
    setPublicationLinkError,
    publicationLinkNotice,
    setPublicationLinkNotice,
    publicationLinkRetry,
    setPublicationLinkRetry,
    publishGates,
    publishQuota,
  };
}

/** The Gallery entry a saved Cloud Project was published as. */
export function useGalleryPublicationLink({
  projectStore,
  capabilities,
  project,
  editorDocumentController,
  projectSessionId,
  publishSession,
  galleryEntryContext,
  setGalleryEntryContext,
  setPublicationLinkLoading,
  setPublicationLinkError,
  setPublicationLinkNotice,
  publicationLinkRetry,
  cloudBinding,
  noteGalleryPublication,
}: {
  projectStore: EditorServices["projectStore"];
  capabilities: EditorServices["capabilities"];
  project: CircuitProject;
  editorDocumentController: EditorDocumentController;
  projectSessionId: string;
  publishSession: GalleryPublishing["publishSession"];
  galleryEntryContext: GalleryPublishing["galleryEntryContext"];
  setGalleryEntryContext: GalleryPublishing["setGalleryEntryContext"];
  setPublicationLinkLoading: GalleryPublishing["setPublicationLinkLoading"];
  setPublicationLinkError: GalleryPublishing["setPublicationLinkError"];
  setPublicationLinkNotice: GalleryPublishing["setPublicationLinkNotice"];
  publicationLinkRetry: GalleryPublishing["publicationLinkRetry"];
  cloudBinding: ProjectFileLifecycle["cloudBinding"];
  noteGalleryPublication: ProjectFileLifecycle["noteGalleryPublication"];
}) {
  useEffect(() => {
    let cancelled = false;
    setPublicationLinkError(null);
    setPublicationLinkNotice(null);
    if (
      !capabilities.community ||
      !projectStore ||
      !cloudBinding ||
      galleryEntryContext
    ) {
      setPublicationLinkLoading(false);
      return;
    }
    setPublicationLinkLoading(true);
    void (async () => {
      try {
        // Read current metadata even for recovery: another tab may have changed the source.
        const listed = await projectStore.list();
        const saved =
          listed.status === "listed"
            ? listed.projects.find((item) => item.id === cloudBinding.id)
            : null;
        if (!saved)
          throw new Error(
            "Could not load the saved Project’s publication link. Retry before publishing.",
          );
        const entryId = saved.galleryEntryId ?? null;
        const context = entryId
          ? await loadGalleryPublicationContext(entryId, project.id)
          : null;
        if (cancelled) return;
        noteGalleryPublication(entryId);
        if (context) {
          setGalleryEntryContext(context);
        } else if (entryId) {
          setPublicationLinkNotice(
            "The original Gallery entry is unavailable. Publishing creates a new entry; the Shelf draft is preserved.",
          );
        }
      } catch (error) {
        if (!cancelled)
          setPublicationLinkError(
            error instanceof Error
              ? error.message
              : "Could not load the publication link.",
          );
      } finally {
        if (!cancelled) setPublicationLinkLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    cloudBinding?.id,
    projectSessionId,
    galleryEntryContext,
    publicationLinkRetry,
    projectStore,
  ]);

  const linkExistingPublication = async (input: string): Promise<void> => {
    const match = input
      .trim()
      .match(/^(?:https?:\/\/[^/]+)?\/g\/([^/?#]+)(?:[?#].*)?$/u);
    const id = match?.[1] ?? input.trim();
    if (!/^[a-zA-Z0-9-]+$/u.test(id))
      throw new Error("Paste a Gallery link or entry id.");
    const sessionId = editorDocumentController.projectSessionId;
    const context = await loadGalleryPublicationContext(id, project.id);
    if (!context || !canUpdateGalleryPublication(context, publishSession))
      throw new Error("Choose a Gallery entry you own or may edit.");
    if (sessionId !== editorDocumentController.projectSessionId)
      throw new Error("The active Project changed. Reopen Publish.");
    setGalleryEntryContext(context);
  };
  return linkExistingPublication;
}

/** Binds a publication to its working copy, for a person or an Agent. */
export function useGalleryPublicationRecord({
  setStatus,
  setGalleryRefreshSignal,
  galleryLoadGenerationRef,
  editorDocumentController,
  setPublishedNotice,
  publishSession,
  galleryEntryContext,
  setGalleryEntryContext,
  agentGalleryPublicationRef,
  recordGalleryPublicationRef,
  cloudBinding,
  noteGalleryPublication,
  noteProjectPublished,
}: {
  setStatus: Dispatch<SetStateAction<string>>;
  setGalleryRefreshSignal: GalleryRefresh["setGalleryRefreshSignal"];
  galleryLoadGenerationRef: GalleryRefresh["galleryLoadGenerationRef"];
  editorDocumentController: EditorDocumentController;
  setPublishedNotice: GalleryPublishing["setPublishedNotice"];
  publishSession: GalleryPublishing["publishSession"];
  galleryEntryContext: GalleryPublishing["galleryEntryContext"];
  setGalleryEntryContext: GalleryPublishing["setGalleryEntryContext"];
  agentGalleryPublicationRef: AgentProjectResources["agentGalleryPublicationRef"];
  recordGalleryPublicationRef: AgentProjectResources["recordGalleryPublicationRef"];
  cloudBinding: ProjectFileLifecycle["cloudBinding"];
  noteGalleryPublication: ProjectFileLifecycle["noteGalleryPublication"];
  noteProjectPublished: ProjectFileLifecycle["noteProjectPublished"];
}) {
  agentGalleryPublicationRef.current = () => ({
    controller: editorDocumentController,
    sessionId: editorDocumentController.projectSessionId,
    project: editorDocumentController.project,
    linked: galleryEntryContext,
    cloudBinding,
  });
  /**
   * What a publication to the Gallery leaves behind, whether a person used
   * the Publish dialog or an Agent published: the working copy is bound to the
   * entry, the wall refreshes, and a notice says where it went. A working copy
   * that changed meanwhile only announces the change.
   */
  function recordGalleryPublication(
    {
      id,
      name,
      description,
      tags,
      aiGenerated,
      updated,
      previewRevision,
      ownerUserId,
      author,
    }: GalleryPublicationRecord,
    sessionId: string,
    by: "person" | "agent",
  ): boolean {
    if (editorDocumentController.projectSessionId !== sessionId) {
      announceGalleryChange({ entryId: id });
      return false;
    }
    // The gallery now holds these exact bytes: leaving, refreshing or closing
    // the tab loses nothing until the next edit.
    noteProjectPublished();
    noteGalleryPublication(id);
    // Publishing establishes the same update-in-place binding as opening an
    // existing Gallery entry. Keep it attached to this Project only;
    // replacing the Project clears it above.
    setGalleryEntryContext({
      id,
      name,
      projectId: editorDocumentController.project.id,
      ownerUserId: updated
        ? (ownerUserId ??
          galleryEntryContext?.ownerUserId ??
          publishSession?.id ??
          null)
        : (publishSession?.id ?? null),
      author: updated
        ? (author ??
          galleryEntryContext?.author ??
          publishSession?.displayName ??
          "")
        : (publishSession?.displayName ?? ""),
      description,
      tags,
      aiGenerated,
    });
    void primeGalleryPreview(id, previewRevision);
    announceGalleryChange({
      entryId: id,
      ...(previewRevision === undefined ? {} : { previewRevision }),
    });
    galleryLoadGenerationRef.current += 1;
    setGalleryRefreshSignal((previous) => previous + 1);
    setStatus(
      by === "agent"
        ? updated
          ? `The Agent updated "${name}" in the gallery`
          : `The Agent published "${name}" to the gallery`
        : updated
          ? `Updated "${name}" in the gallery`
          : `Published "${name}" to the gallery`,
    );
    setPublishedNotice({ id, name, updated });
    return true;
  }
  recordGalleryPublicationRef.current = recordGalleryPublication;
  return recordGalleryPublication;
}
