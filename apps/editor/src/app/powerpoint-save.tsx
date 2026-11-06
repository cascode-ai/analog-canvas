import { useEffect, useRef, useState } from "react";
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

/** Saves one immutable editor snapshot and waits for PowerPoint's acknowledgement. */
export function PowerPointSave({
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
}) {
  const [token, setToken] = useState<string | null>(null);
  const [context, setContext] = useState<{
    projectId: string;
    documentId?: string;
  } | null>(null);
  const restored = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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
    if (!restored.current && context?.projectId === project.id) {
      restored.current = true;
      if (
        context.documentId &&
        context.documentId !== document.id &&
        project.documents.some((d) => d.id === context.documentId)
      )
        openDocument(context.documentId);
    }
  }, [context, project, document.id, openDocument]);
  async function save(): Promise<SaveOutcome> {
    if (pending.current)
      return {
        status: "failed",
        message: "A save is already running. Please wait.",
      };
    const reason = blocker();
    if (reason) {
      const message = `Finish the current operation first: ${reason}`;
      setMessage(message);
      return { status: "failed", message };
    }
    pending.current = true;
    setBusy(true);
    setMessage("Updating PowerPoint…");
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
          closeBridge.current!.acknowledge({
            tabId: entry.tabId,
            name: snapshot.name,
            project: projectText,
            documentId: sourceDocument.id,
          });
          setMessage(
            "Drawing updated. Save your presentation in PowerPoint. A local project backup is retained.",
          );
          return { status: "saved" };
        }
      }
      throw new Error(
        "PowerPoint has not acknowledged the update. A project backup is retained. Return to PowerPoint and choose Receive update.",
      );
    } catch (error) {
      setMessage(String(error));
      return { status: "failed", message: String(error) };
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (!token) return null;
  return (
    <aside
      style={{
        position: "fixed",
        right: 20,
        bottom: 36,
        zIndex: 10000,
        maxWidth: 440,
        background: "#ffffff",
        color: "#16352d",
        padding: 12,
        border: "1px solid #728f85",
        borderRadius: 8,
        boxShadow: "0 3px 12px #0002",
      }}
    >
      <button
        onClick={() => void save()}
        disabled={busy || context?.projectId !== project.id}
        style={{
          background: "#176d55",
          color: "white",
          padding: "10px 20px",
          borderRadius: 5,
        }}
      >
        {busy ? "Saving…" : "Save to PowerPoint"}
      </button>
      <div role="status" style={{ fontSize: 12, marginTop: 6 }}>
        {context?.projectId !== project.id
          ? "Return to the linked PowerPoint project tab."
          : message ||
            "Save this Cell and its editable project to the linked slide."}
      </div>
    </aside>
  );
}
