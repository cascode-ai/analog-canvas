import { useEffect, useRef } from "react";
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

// A page-local fallback keeps internal project tabs usable when the browser
// denies the optional async clipboard API. Native copy still crosses windows.
let localClipboard: { text: string; synced: boolean } | null = null;

/** Clipboard events are synchronous and need no clipboard permission or shared storage. */
export function useCircuitClipboard(options: Options) {
  const current = useRef(options);
  current.current = options;
  const operation = useRef(0);
  const copySelection = async () => {
    const owner = current.current;
    const action = ++operation.current;
    if (!owner.enabled) return;
    try {
      const text = encodeCircuitClipboard(
        owner.project,
        owner.document,
        owner.selection,
      );
      if (!text) {
        owner.setStatus("Select components or wires before copying");
        return;
      }
      const copied = { text, synced: false };
      localClipboard = copied;
      owner.setStatus(
        "Circuit copied · switch to another canvas and paste to place",
      );
      try {
        await navigator.clipboard.writeText(text);
        copied.synced = true;
      } catch {
        /* Internal tabs can still use the complete selection. */
      }
      if (
        action !== operation.current ||
        current.current.project !== owner.project
      )
        return;
      owner.setStatus(
        copied.synced
          ? "Circuit copied · switch to another canvas and paste to place"
          : "Circuit copied within this page · V pastes into another project tab",
      );
    } catch (error) {
      owner.setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const pasteSelection = async () => {
    const owner = current.current;
    const action = ++operation.current;
    if (!owner.enabled) return;
    try {
      let text: string;
      if (localClipboard && !localClipboard.synced) text = localClipboard.text;
      else {
        try {
          text = await navigator.clipboard.readText();
        } catch {
          if (!localClipboard)
            throw new Error(
              "Use Ctrl/Cmd+V to paste from the system clipboard",
            );
          text = localClipboard.text;
        }
      }
      // A permission prompt/read must not paste into a subsequently opened project.
      if (
        !current.current.enabled ||
        action !== operation.current ||
        current.current.project !== owner.project ||
        current.current.document !== owner.document
      )
        return;
      const clipboard = decodeCircuitClipboard(text);
      if (!clipboard) {
        owner.setStatus("No circuit selection in the clipboard");
        return;
      }
      owner.beginPaste(clipboard);
    } catch (error) {
      owner.setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    const ownsEvent = (event: ClipboardEvent | KeyboardEvent) =>
      options.enabled &&
      !event.defaultPrevented &&
      !isTypingTarget(event.target) &&
      !(
        event.target instanceof Element &&
        event.target.closest(
          '[role="dialog"], dialog, .simulation-code-workspace, [data-workspace-interaction]',
        )
      ) &&
      // Canvas focus owns circuit operations even when an earlier header/code
      // text selection survived the pointer handler's preventDefault().
      (Boolean(
        event.target instanceof Element &&
        event.target.closest('[data-testid="schematic-canvas"]'),
      ) ||
        !window.getSelection()?.toString());
    const report = (error: unknown) =>
      options.setStatus(error instanceof Error ? error.message : String(error));
    const copy = (event: ClipboardEvent) => {
      if (!ownsEvent(event) || !event.clipboardData) return;
      try {
        operation.current += 1;
        const text = encodeCircuitClipboard(
          options.project,
          options.document,
          options.selection,
        );
        if (!text) return;
        event.clipboardData.setData("text/plain", text);
        event.preventDefault();
        localClipboard = { text, synced: true };
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
        operation.current += 1;
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
    const alternateShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        !ownsEvent(event) ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.repeat ||
        (key !== "c" && key !== "v")
      )
        return;
      // Keep the platform chord native: synchronous copy/paste events work
      // without async clipboard permission. The other modifier must invoke
      // the same C/V operations because the browser emits no clipboard event.
      if (
        event.target instanceof Element &&
        event.target.closest('[data-testid="schematic-canvas"]')
      )
        window.getSelection()?.removeAllRanges();
      const apple = /Mac|iPhone|iPad|iPod/u.test(navigator.platform);
      if (apple ? event.metaKey : event.ctrlKey) return;
      event.preventDefault();
      if (key === "c") void copySelection();
      else void pasteSelection();
    };
    window.addEventListener("keydown", alternateShortcut);
    window.addEventListener("copy", copy);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("keydown", alternateShortcut);
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
  return { copySelection, pasteSelection };
}
