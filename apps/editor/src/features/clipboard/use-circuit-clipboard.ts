import { useEffect } from "react";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { isTypingTarget } from "../../app/editor-runtime-helpers";
import type { SchematicClipboard } from "./clipboard";
import {
  CIRCUIT_CLIPBOARD_MIME,
  decodeCircuitClipboard,
  encodeCircuitClipboard,
} from "./system-clipboard";

type Options = {
  project: CircuitProject;
  document: SchematicDocument;
  selection: Parameters<typeof encodeCircuitClipboard>[2];
  enabled: boolean;
  setStatus: (message: string) => void;
  beginPaste: (clipboard: SchematicClipboard) => void;
};

/** Clipboard events are synchronous and need no clipboard permission or shared storage. */
export function useCircuitClipboard(options: Options): void {
  useEffect(() => {
    const ownsEvent = (event: ClipboardEvent) =>
      options.enabled &&
      !event.defaultPrevented &&
      !isTypingTarget(event.target) &&
      !(
        event.target instanceof Element &&
        event.target.closest(
          '[role="dialog"], dialog, .simulation-code-workspace, [data-workspace-interaction]',
        )
      ) &&
      !window.getSelection()?.toString();
    const report = (error: unknown) =>
      options.setStatus(error instanceof Error ? error.message : String(error));
    const copy = (event: ClipboardEvent) => {
      if (!ownsEvent(event) || !event.clipboardData) return;
      try {
        const text = encodeCircuitClipboard(
          options.project,
          options.document,
          options.selection,
        );
        if (!text) return;
        event.clipboardData.setData("text/plain", text);
        event.preventDefault();
        try {
          event.clipboardData.setData(CIRCUIT_CLIPBOARD_MIME, text);
        } catch {
          /* Some browsers accept only standard MIME types; text/plain is sufficient. */
        }
        options.setStatus(
          "Circuit copied · switch to another canvas and paste to place",
        );
      } catch (error) {
        event.preventDefault();
        report(error);
      }
    };
    const paste = (event: ClipboardEvent) => {
      if (!ownsEvent(event) || !event.clipboardData) return;
      try {
        const text =
          event.clipboardData.getData(CIRCUIT_CLIPBOARD_MIME) ||
          event.clipboardData.getData("text/plain");
        const clipboard = decodeCircuitClipboard(text);
        if (!clipboard) return;
        event.preventDefault();
        options.beginPaste(clipboard);
      } catch (error) {
        event.preventDefault();
        report(error);
      }
    };
    window.addEventListener("copy", copy);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("copy", copy);
      window.removeEventListener("paste", paste);
    };
  }, [
    options.project,
    options.document,
    options.selection,
    options.enabled,
    options.setStatus,
    options.beginPaste,
  ]);
}
