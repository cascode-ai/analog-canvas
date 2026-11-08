import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { serializeProject } from "@icm/project-protocol";
import { createSvgExportArtifact } from "../features/editor-shell/editor-export-commands";
import {
  createPowerPointCloseBridge,
  type NativeCloseBridge,
  type PowerPointDrawing,
  type SaveOutcome,
} from "./powerpoint-close";

/** Where the linked slide stands against the drawing on screen. */
export type PowerPointLinkState = "saved" | "unsaved" | "elsewhere";

export interface PowerPointNotice {
  readonly id: number;
  readonly text: string;
  readonly failed: boolean;
}

/** Long enough to read a sentence; a failure says more, so it stays longer. */
const SAVED_NOTICE_MS = 4_000;
const FAILED_NOTICE_MS = 8_000;
/** The fade at the end of a notice's time, as the stylesheet draws it. */
const NOTICE_FADE_MS = 400;

const RETURN_TO_LINKED_TAB = "Return to the linked PowerPoint project tab.";

const LINK_TITLES: Record<PowerPointLinkState, string> = {
  saved: "The linked slide shows this drawing. Click to save it again.",
  unsaved: "Changes not yet on the linked slide. Click to save them.",
  elsewhere: RETURN_TO_LINKED_TAB,
};

/**
 * The PowerPoint link of a PowerPoint-launched session: saving one immutable
 * editor snapshot to the slide and waiting for PowerPoint's acknowledgement,
 * the close bridge, and whether the slide shows what is on screen.
 *
 * It lives with the editor, not the header, so the link and the close bridge
 * survive whatever the header shows; `action` is the header's button and
 * `notice` the brief outcome under it. A Web session never links: both are
 * null.
 */
export function usePowerPointSave({
  project,
  document,
  blocker,
  capture,
  openDocument,
  readProject,
}: {
  project: CircuitProject;
  document: SchematicDocument;
  blocker: () => string | null;
  capture: () => Promise<CircuitProject | null>;
  openDocument: (id: string) => void;
  readProject: (
    id: string,
  ) => { tabId: string; project: CircuitProject; documentId: string } | null;
}): { action: ReactNode; notice: ReactNode } {
  const [token, setToken] = useState<string | null>(null);
  const [context, setContext] = useState<{
    projectId: string;
    documentId?: string;
  } | null>(null);
  const restored = useRef(false);
  const [busy, setBusy] = useState(false);
  const { notice, report, dismiss } = useSlideNotices();
  /** The drawing the slide was last known to show, as the close bridge has it. */
  const [receipt, setReceipt] = useState<SlideReceipt | null>(null);
  const pending = useRef(false);
  function currentDrawing(): PowerPointDrawing | null {
    const entry = context && readProject(context.projectId);
    return entry
      ? {
          tabId: entry.tabId,
          name: entry.project.name,
          project: serializeProject(entry.project),
          documentId: entry.documentId,
        }
      : null;
  }
  const latest = useRef({ drawing: currentDrawing, save });
  latest.current = { drawing: currentDrawing, save };
  const closeBridge = useRef<ReturnType<
    typeof createPowerPointCloseBridge
  > | null>(null);
  if (!closeBridge.current)
    closeBridge.current = createPowerPointCloseBridge({
      drawing: () => latest.current.drawing(),
      native: () =>
        (window as unknown as { __analogCanvasDesktop?: NativeCloseBridge })
          .__analogCanvasDesktop,
      busy: () => pending.current,
      saveDrawing: () => latest.current.save(),
    });
  /** The slide now shows this drawing: the close prompt and the dot agree. */
  function acknowledge(
    snapshot: CircuitProject,
    drawing: PowerPointDrawing,
  ): void {
    closeBridge.current!.acknowledge(drawing);
    setReceipt({
      project: snapshot,
      text: drawing.project,
      documentId: drawing.documentId,
    });
  }
  useEffect(() => {
    if (!token || !context) return;
    const target = window as unknown as Record<string, unknown>;
    const bridge = closeBridge.current;
    target.__circuitPowerPoint = bridge;
    return () => {
      if (target.__circuitPowerPoint === bridge)
        delete target.__circuitPowerPoint;
    };
  }, [token, context]);
  useEffect(() => {
    if (!import.meta.env.ICM_DESKTOP) return;
    void fetch("/desktop/powerpoint")
      .then((r) => r.json())
      .then(
        (v: {
          enabled: boolean;
          token?: string;
          projectId: string;
          documentId?: string;
        }) => {
          if (v.enabled && v.token) {
            setToken(v.token);
            setContext(v);
          }
        },
      )
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (restored.current || context?.projectId !== project.id) return;
    const entry = readProject(context.projectId);
    if (!entry) return;
    restored.current = true;
    const shown =
      context.documentId &&
      project.documents.some((d) => d.id === context.documentId)
        ? context.documentId
        : document.id;
    // The slide shows the drawing it opened: unedited, it needs no save.
    acknowledge(entry.project, {
      tabId: entry.tabId,
      name: entry.project.name,
      project: serializeProject(entry.project),
      documentId: shown,
    });
    if (shown !== document.id) openDocument(shown);
  }, [context, project, document.id, openDocument, readProject]);
  const linkedHere = token !== null && context?.projectId === project.id;
  const state = useSlideState(project, document, linkedHere, receipt);

  async function save(): Promise<SaveOutcome> {
    if (pending.current)
      return {
        status: "failed",
        message: "A save is already running. Please wait.",
      };
    const reason = blocker();
    if (reason) {
      const message = `Finish the current operation first: ${reason}`;
      report(message, true);
      return { status: "failed", message };
    }
    pending.current = true;
    setBusy(true);
    try {
      const entry = context && readProject(context.projectId);
      if (!token || !entry)
        throw new Error(
          "Open the linked project tab and close any duplicate copies before saving.",
        );
      const snapshot =
        project.id === context?.projectId ? await capture() : entry.project;
      if (!snapshot || snapshot.id !== context?.projectId)
        throw new Error(
          "Return to the linked PowerPoint project and finish the current edit.",
        );
      const sourceDocument = snapshot.documents.find(
        (d) => d.id === entry.documentId,
      );
      if (!sourceDocument)
        throw new Error("The current Cell changed. Please try again.");
      const projectText = serializeProject(snapshot);
      const artifact = await createSvgExportArtifact(
        sourceDocument,
        createProjectSymbolResolver(snapshot, builtInSymbols),
        snapshot.name,
      );
      const svg = await new Blob([artifact.bytes]).text();
      const response = await fetch("/desktop/powerpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          project: projectText,
          svg,
          documentId: sourceDocument.id,
        }),
      });
      const result = (await response.json()) as {
        sequence: number;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Save failed");
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const status = (await fetch("/desktop/powerpoint").then((r) =>
          r.json(),
        )) as { ack?: { sequence: number; ok: boolean; error?: string } };
        if (status.ack?.sequence === result.sequence) {
          if (!status.ack.ok)
            throw new Error(
              status.ack.error ?? "PowerPoint could not update the drawing",
            );
          acknowledge(snapshot, {
            tabId: entry.tabId,
            name: snapshot.name,
            project: projectText,
            documentId: sourceDocument.id,
          });
          report(
            "Drawing updated. Save your presentation in PowerPoint.",
            false,
          );
          return { status: "saved" };
        }
      }
      throw new Error(
        "PowerPoint has not acknowledged the update. A project backup is retained. Close any PowerPoint dialog to allow the update to finish automatically.",
      );
    } catch (error) {
      report(String(error), true);
      return { status: "failed", message: String(error) };
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  if (!token) return { action: null, notice: null };
  return {
    action: (
      <PowerPointButton
        state={state}
        busy={busy}
        onSave={() => {
          if (state === "elsewhere") report(RETURN_TO_LINKED_TAB, true);
          else void save();
        }}
      />
    ),
    notice: notice ? (
      <PowerPointNoticeView
        key={notice.id}
        notice={notice}
        onDismiss={dismiss}
      />
    ) : null,
  };
}

/** What the slide shows, for the state on the header's dot. */
export interface SlideReceipt {
  readonly project: CircuitProject;
  readonly text: string;
  readonly documentId: string;
}

/**
 * Where the linked slide stands against the drawing on screen. Identity
 * answers at once; after an edit, the text says whether the drawing came back
 * to what the slide shows (undo, say). Deferred, so a linked drawing never
 * waits on serializing while it is being edited.
 */
export function useSlideState(
  project: CircuitProject,
  document: SchematicDocument,
  linkedHere: boolean,
  receipt: SlideReceipt | null,
): PowerPointLinkState {
  const deferredProject = useDeferredValue(project);
  const deferredText = useMemo(
    () =>
      linkedHere && receipt && deferredProject !== receipt.project
        ? serializeProject(deferredProject)
        : null,
    [linkedHere, receipt, deferredProject],
  );
  return !linkedHere
    ? "elsewhere"
    : receipt !== null &&
        document.id === receipt.documentId &&
        (project === receipt.project ||
          (deferredProject === project && deferredText === receipt.text))
      ? "saved"
      : "unsaved";
}

/** A save's outcomes, one at a time, each fading by itself. */
export function useSlideNotices() {
  const [notice, setNotice] = useState<PowerPointNotice | null>(null);
  const noticeId = useRef(0);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(
      () => setNotice((current) => (current === notice ? null : current)),
      notice.failed ? FAILED_NOTICE_MS : SAVED_NOTICE_MS,
    );
    return () => clearTimeout(timer);
  }, [notice]);
  return {
    notice,
    report(text: string, failed: boolean) {
      noticeId.current += 1;
      setNotice({ id: noticeId.current, text, failed });
    },
    dismiss: () => setNotice(null),
  };
}

/** The header's PowerPoint control: one button and a dot for the slide's state. */
export function PowerPointButton({
  state,
  busy,
  onSave,
}: {
  state: PowerPointLinkState;
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <button
      type="button"
      className="app-action powerpoint-save"
      data-testid="powerpoint-save"
      data-state={state}
      aria-label="Save to PowerPoint"
      // Another tab is not the slide's: the button greys and says where to
      // go, rather than going silent the way a disabled button would.
      aria-disabled={state === "elsewhere" || undefined}
      disabled={busy}
      aria-busy={busy || undefined}
      title={LINK_TITLES[state]}
      onClick={onSave}
    >
      <svg className="app-action-icon" viewBox="0 0 16 16" aria-hidden="true">
        <rect
          x="1.75"
          y="2.25"
          width="12.5"
          height="8.5"
          rx="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M8 10.75v2.5M5.5 13.75h5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
      {/* Both words hold the width, so saving never moves the header. */}
      <span className="app-action-label powerpoint-save-label">
        <span aria-hidden={busy}>PowerPoint</span>
        <span aria-hidden={!busy}>Saving…</span>
      </span>
      <span className="powerpoint-save-dot" aria-hidden="true" />
    </button>
  );
}

/** A save's outcome, briefly, below the header; it fades by itself. */
export function PowerPointNoticeView({
  notice,
  onDismiss,
}: {
  notice: PowerPointNotice;
  onDismiss: () => void;
}) {
  return (
    <aside
      className="powerpoint-notice"
      data-testid="powerpoint-notice"
      data-failed={notice.failed || undefined}
      aria-label="PowerPoint"
      style={{
        animationDelay: `0ms, ${(notice.failed ? FAILED_NOTICE_MS : SAVED_NOTICE_MS) - NOTICE_FADE_MS}ms`,
      }}
    >
      <span className="powerpoint-notice-mark" aria-hidden="true">
        {notice.failed ? "!" : "✓"}
      </span>
      <span role="status">{notice.text}</span>
      <button
        type="button"
        aria-label="Dismiss PowerPoint notice"
        onClick={onDismiss}
      >
        ×
      </button>
    </aside>
  );
}
