import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { createSvgExportArtifact } from "../features/editor-shell/editor-export-commands";
import {
  PowerPointButton,
  PowerPointNoticeView,
  useSlideNotices,
  useSlideState,
  type SlideReceipt,
} from "./powerpoint-save";
import {
  OFFICE_DIALOG_PARAMETER,
  createChunkReceiver,
  sendChunked,
  type OfficeMessage,
} from "./office-messages";

/** Microsoft's hosted Office.js, the only way an add-in reaches its host. */
const OFFICE_JS = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";
const ACK_TIMEOUT_MS = 60_000;
/** The dialog keeps its mode across the editor's own page changes. */
const OFFICE_SESSION_KEY = "icm.office-dialog";

interface OfficeDialogUi {
  messageParent(message: string): void;
  addHandlerAsync(
    eventType: string,
    handler: (event: { message: string }) => void,
    callback?: (result: { status: string }) => void,
  ): void;
}
interface OfficeGlobal {
  onReady(): Promise<{ host: string | null }>;
  context: { ui: OfficeDialogUi };
  EventType: { DialogParentMessageReceived: string };
}

/** True in the editor the PowerPoint add-in opens as its dialog. */
export function isOfficeDialog(): boolean {
  if (typeof window === "undefined") return false;
  if (
    new URLSearchParams(window.location.search).get(OFFICE_DIALOG_PARAMETER) ===
    "dialog"
  ) {
    window.sessionStorage.setItem(OFFICE_SESSION_KEY, "1");
    return true;
  }
  return window.sessionStorage.getItem(OFFICE_SESSION_KEY) === "1";
}

let officeReady: Promise<OfficeGlobal | null> | undefined;
/**
 * Office.js, loaded once. It clears history.pushState and replaceState for
 * hosts that lack them; the editor keeps the browser's own.
 */
function loadOffice(): Promise<OfficeGlobal | null> {
  return (officeReady ??= new Promise((resolve) => {
    const { pushState, replaceState } = window.history;
    const script = window.document.createElement("script");
    script.src = OFFICE_JS;
    script.onload = () => {
      window.history.pushState = pushState;
      window.history.replaceState = replaceState;
      const office = (window as unknown as { Office?: OfficeGlobal }).Office;
      if (!office) return resolve(null);
      void office
        .onReady()
        .then((info) => resolve(info.host ? office : null))
        .catch(() => resolve(null));
    };
    script.onerror = () => resolve(null);
    window.document.head.append(script);
  }));
}

/**
 * The editor as the PowerPoint add-in's dialog (`?office=dialog`). The add-in
 * sends the drawing to open, none for a new one, or nothing again after the
 * page changed. The header's PowerPoint button places the drawing on screen
 * on the slide picture this window edits, as the desktop's does through its
 * host; an example or another tab placed there replaces it. Nothing happens
 * on any other page.
 */
export function useOfficeLink({
  project,
  document,
  blocker,
  capture,
  openDocument,
  openProjectText,
  openNewProject,
}: {
  project: CircuitProject;
  document: SchematicDocument;
  blocker: () => string | null;
  capture: () => Promise<CircuitProject | null>;
  openDocument: (id: string) => void;
  /** `replace`: in place of the drawing on screen, else in a new tab. */
  openProjectText: (
    text: string,
    name: string,
    replace: boolean,
  ) => Promise<boolean>;
  openNewProject: () => void;
}): { action: ReactNode; notice: ReactNode } {
  const [office, setOffice] = useState<OfficeGlobal | null>(null);
  /** What the slide picture shows, once known. */
  const [receipt, setReceipt] = useState<SlideReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const { notice, report, dismiss } = useSlideNotices();
  /** The opened drawing: its Project and the Cell the slide shows. */
  const opened = useRef<{ id: string; documentId: string } | null>(null);
  const acks = useRef(
    new Map<
      string,
      (message: Extract<OfficeMessage, { type: "ack" }>) => void
    >(),
  );
  // The dialog starts on an empty drawing: what the add-in opens takes its
  // place rather than a tab beside it.
  const blank = project.documents.every(
    (d) =>
      d.instances.length === 0 &&
      d.routes.length === 0 &&
      d.annotations.length === 0,
  );
  const latest = useRef({ openProjectText, openNewProject, blank });
  latest.current = { openProjectText, openNewProject, blank };

  useEffect(() => {
    if (!isOfficeDialog()) return;
    let active = true;
    // PowerPoint for Mac closes its dialog, unsaved work and all, on an Escape
    // the page leaves unhandled; in the editor Escape only cancels.
    const keepEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.preventDefault();
    };
    window.addEventListener("keydown", keepEscape);
    void loadOffice().then((loaded) => {
      if (!active || !loaded) return;
      setOffice(loaded);
      const receive = createChunkReceiver((message) => {
        if (message.type === "ack") {
          acks.current.get(message.requestId)?.(message);
          acks.current.delete(message.requestId);
        } else if (message.type === "open") {
          if (message.project) {
            const id = (JSON.parse(message.project) as { id: string }).id;
            // A drawing read from a slide picture names its Cell; an example
            // is not on the slide yet.
            opened.current = message.documentId
              ? { id, documentId: message.documentId }
              : null;
            void latest.current.openProjectText(
              message.project,
              message.name ?? "Slide circuit",
              latest.current.blank,
            );
          } else if (!message.attach && !latest.current.blank)
            latest.current.openNewProject();
        }
      });
      loaded.context.ui.addHandlerAsync(
        loaded.EventType.DialogParentMessageReceived,
        (event) => receive(event.message),
      );
      sendChunked((text) => loaded.context.ui.messageParent(text), {
        type: "ready",
      });
    });
    return () => {
      active = false;
      window.removeEventListener("keydown", keepEscape);
    };
  }, []);

  // The opened drawing is what the slide shows, on its own Cell.
  useEffect(() => {
    const target = opened.current;
    if (!target || project.id !== target.id) return;
    opened.current = null;
    const shown = project.documents.some((d) => d.id === target.documentId)
      ? target.documentId
      : document.id;
    setReceipt({ project, text: serializeProject(project), documentId: shown });
    if (shown !== document.id) openDocument(shown);
  }, [project, document.id, openDocument]);

  const state = useSlideState(project, document, office !== null, receipt);

  async function save(): Promise<void> {
    if (!office || busy) return;
    const reason = blocker();
    if (reason) {
      report(`Finish the current operation first: ${reason}`, true);
      return;
    }
    setBusy(true);
    try {
      const snapshot = await capture();
      if (!snapshot) throw new Error("Finish the current edit first.");
      const sourceDocument = snapshot.documents.find(
        (d) => d.id === document.id,
      );
      if (!sourceDocument)
        throw new Error("The current Cell changed. Please try again.");
      const text = serializeProject(snapshot);
      const artifact = await createSvgExportArtifact(
        sourceDocument,
        createProjectSymbolResolver(snapshot, builtInSymbols),
        snapshot.name,
      );
      const svg = await new Blob([artifact.bytes]).text();
      const requestId = crypto.randomUUID();
      const ack = new Promise<Extract<OfficeMessage, { type: "ack" }>>(
        (resolve, reject) => {
          const timer = setTimeout(() => {
            acks.current.delete(requestId);
            reject(new Error("PowerPoint did not answer. Is the add-in open?"));
          }, ACK_TIMEOUT_MS);
          acks.current.set(requestId, (message) => {
            clearTimeout(timer);
            resolve(message);
          });
        },
      );
      sendChunked((chunk) => office.context.ui.messageParent(chunk), {
        type: "save",
        requestId,
        name: snapshot.name,
        project: text,
        documentId: sourceDocument.id,
        svg,
      });
      const answer = await ack;
      if (!answer.ok)
        throw new Error(
          answer.error ?? "PowerPoint could not place the drawing",
        );
      setReceipt({ project: snapshot, text, documentId: sourceDocument.id });
      report("Drawing placed on the slide.", false);
    } catch (error) {
      report(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  }

  if (!office) return { action: null, notice: null };
  return {
    action: (
      <PowerPointButton state={state} busy={busy} onSave={() => void save()} />
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
