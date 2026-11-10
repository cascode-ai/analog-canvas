// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { expect, it, vi } from "vitest";

import { importSpiceSources } from "@icm/spice";
import type { CircuitProject } from "@icm/model";

import { NetlistCodePanel } from "../netlist-export/netlist-code-panel";
import { createDefaultNetlistExportPreferences } from "../netlist-export/netlist-export-preferences";
import { useHeldCodeDraft, type CodeDraftDocument } from "./held-code-draft";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/**
 * A code panel the editor shows, hides and moves between Project sessions,
 * with the draft holder the editor gives it, and what that holder reports.
 */
async function hostPanel(
  panel: (draftDocument: CodeDraftDocument, sessionId: string) => ReactNode,
) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  const dirty: boolean[] = [];
  function Host({ open, sessionId }: { open: boolean; sessionId: string }) {
    const held = useHeldCodeDraft(sessionId);
    dirty.push(held.dirty);
    return open ? panel(held.document, sessionId) : null;
  }
  const editor = async () => {
    await vi.waitFor(() => {
      if (!host.querySelector(".cm-content")) throw new Error("editor loading");
    });
    return EditorView.findFromDOM(host.querySelector(".cm-content")!)!;
  };
  const show = async (open: boolean, sessionId = "project:1") => {
    await act(async () =>
      root.render(<Host open={open} sessionId={sessionId} />),
    );
    return open ? editor() : null;
  };
  const type = (view: EditorView, edit: (source: string) => string) =>
    act(async () => {
      const source = view.state.doc.toString();
      view.dispatch({
        changes: { from: 0, to: source.length, insert: edit(source) },
      });
    });
  const button = (name: string) =>
    [...host.querySelectorAll("button")].find(
      (item) =>
        item.textContent === name || item.getAttribute("aria-label") === name,
    ) ?? null;
  const text = () => host.textContent ?? "";
  const close = () => act(async () => root.unmount());
  return { dirty, show, type, button, text, close };
}

async function resistorProject(): Promise<CircuitProject> {
  const imported = await importSpiceSources(
    [
      {
        path: "top.spi",
        bytes: new TextEncoder().encode(
          ".subckt top A B\nRLOAD A B 15k\nRS A B 1k\n.ends top\n",
        ),
      },
    ],
    "top.spi",
  );
  expect(imported.successful, JSON.stringify(imported.diagnostics)).toBe(true);
  return imported.project!;
}

it("keeps an unapplied Netlist draft through closing and reopening the panel (#2193)", async () => {
  const project = await resistorProject();
  const onApply = vi.fn(() => true);
  const { dirty, show, type, button, close } = await hostPanel(
    (draftDocument, sessionId) => (
      <NetlistCodePanel
        key={sessionId}
        draftDocument={draftDocument}
        project={project}
        format="spice"
        namingProfile="native"
        profiles={createDefaultNetlistExportPreferences().profiles}
        selectedProcess="abstract"
        onProcessChange={vi.fn()}
        onDeviceTargetChange={vi.fn()}
        onModeChange={vi.fn()}
        onApply={onApply}
        onFocusInstance={vi.fn()}
        onReset={vi.fn()}
        onCopy={vi.fn()}
        configurationError={null}
      />
    ),
  );
  let view = (await show(true))!;
  const live = view.state.doc.toString();
  expect(live).toContain("RLOAD A B 15k");
  // One value changed, another not written yet: the draft cannot apply.
  const draft = live
    .replace("RLOAD A B 15k", "RLOAD A B 47k")
    .replace(/(RS A B) \S+/u, "$1 ");
  await type(view, () => draft);
  expect(button("Reload")).not.toBeNull();
  expect(button("Copy netlist")?.disabled).toBe(true);

  // Closing the sidebar, or showing Testbench in its place, unmounts it.
  await show(false);
  const heldWhileClosed = dirty.at(-1);
  view = (await show(true))!;
  expect(view.state.doc.toString()).toBe(draft);
  // The hidden draft still holds the Project tab, as an open one does.
  expect(heldWhileClosed).toBe(true);
  expect(button("Reload")).not.toBeNull();
  expect(button("Copy netlist")?.disabled).toBe(true);
  expect(onApply).not.toHaveBeenCalled();

  // Another Project session never sees it.
  view = (await show(true, "project:2"))!;
  expect(view.state.doc.toString()).toBe(live);
  expect(dirty.at(-1)).toBe(false);

  // Only Reload drops it.
  view = (await show(true))!;
  await type(view, () => draft);
  await act(async () => button("Reload")!.click());
  expect(view.state.doc.toString()).toBe(live);
  expect(button("Reload")).toBeNull();
  expect(dirty.at(-1)).toBe(false);
  await close();
});
