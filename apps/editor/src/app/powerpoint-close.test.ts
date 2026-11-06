import { describe, expect, it } from "vitest";
import { createPowerPointCloseBridge } from "./powerpoint-close";
import { decideClose } from "../../../desktop/src/close-guard";

describe("PowerPoint window save contract", () => {
  it("stops asking after PPT acknowledges, even if the local file is dirty", () => {
    const drawing = {
      tabId: "ppt-tab",
      name: "Circuit",
      project: "saved circuit",
      documentId: "main",
    };
    const bridge = createPowerPointCloseBridge({
      drawing: () => drawing,
      native: () => ({
        state: () => ({
          dirty: [{ id: "ppt-tab", name: "Circuit" }],
          busy: false,
          pendingEdits: false,
        }),
        save: async () => ({ status: "saved" }),
      }),
      busy: () => false,
      saveDrawing: async () => ({ status: "saved" }),
    });
    expect(bridge.state()?.dirty).toHaveLength(1);
    bridge.acknowledge(drawing);
    expect(bridge.state()?.dirty).toEqual([]);
  });
  it.each(["failed", "cancelled"])(
    "keeps the editor open when PPT save is %s",
    async (status) => {
      const drawing = {
        tabId: "ppt-tab",
        name: "Circuit",
        project: "new circuit",
        documentId: "main",
      };
      const bridge = createPowerPointCloseBridge({
        drawing: () => drawing,
        native: () => ({
          state: () => ({ dirty: [], busy: false, pendingEdits: false }),
          save: async () => {
            throw new Error("Must not treat local Save as a PPT receipt");
          },
        }),
        busy: () => false,
        saveDrawing: async () => ({ status, message: "PPT unavailable" }),
      });
      const outcome = await decideClose({
        readState: async () => bridge.state(),
        ask: async () => "save",
        save: bridge.save,
        flushWorkspace: async () => {},
        reportFailure: async () => {},
      });
      expect(outcome).toBe("stay");
      expect(bridge.state()?.dirty).toHaveLength(1);
    },
  );
  it.each([false, true])(
    "waits for PPT and preserves newer edits: %s",
    async (editDuringSave) => {
      let drawing = {
        tabId: "ppt-tab",
        name: "Circuit",
        project: "first circuit",
        documentId: "main",
      };
      let acknowledge!: () => void;
      const receipt = new Promise<void>((resolve) => {
        acknowledge = resolve;
      });
      const bridge = createPowerPointCloseBridge({
        drawing: () => drawing,
        native: () => ({
          state: () => ({ dirty: [], busy: false, pendingEdits: false }),
          save: async () => ({ status: "saved" }),
        }),
        busy: () => false,
        saveDrawing: async () => {
          const snapshot = drawing;
          await receipt;
          bridge.acknowledge(snapshot);
          return { status: "saved" };
        },
      });
      let closed = false;
      const closing = decideClose({
        readState: async () => bridge.state(),
        ask: async () => "save",
        save: bridge.save,
        flushWorkspace: async () => {
          closed = true;
        },
        reportFailure: async () => {},
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(closed).toBe(false);
      if (editDuringSave) drawing = { ...drawing, project: "newer circuit" };
      acknowledge();
      expect(await closing).toBe(editDuringSave ? "stay" : "close");
    },
  );
  it("keeps other tabs on their native saving path without resending the acknowledged PPT", async () => {
    const drawing = {
      tabId: "ppt-tab",
      name: "Circuit",
      project: "circuit",
      documentId: "main",
    };
    let otherDirty = true;
    const bridge = createPowerPointCloseBridge({
      drawing: () => drawing,
      native: () => ({
        state: () => ({
          dirty: otherDirty ? [{ id: "other", name: "Other project" }] : [],
          busy: false,
          pendingEdits: false,
        }),
        save: async () => {
          otherDirty = false;
          return { status: "saved" };
        },
      }),
      busy: () => false,
      saveDrawing: async () => {
        throw new Error("PPT is already current");
      },
    });
    bridge.acknowledge(drawing);
    expect(bridge.state()?.dirty).toEqual([
      { id: "other", name: "Other project" },
    ]);
    expect(await bridge.save()).toEqual({ status: "saved" });
    expect(bridge.state()?.dirty).toEqual([]);
  });
  it("tracks a changed Cell even when the project content has not changed", () => {
    let drawing = {
      tabId: "ppt-tab",
      name: "Circuit",
      project: "circuit",
      documentId: "main",
    };
    const bridge = createPowerPointCloseBridge({
      drawing: () => drawing,
      native: () => ({
        state: () => ({ dirty: [], busy: false, pendingEdits: false }),
        save: async () => ({ status: "saved" }),
      }),
      busy: () => false,
      saveDrawing: async () => ({ status: "saved" }),
    });
    bridge.acknowledge(drawing);
    drawing = { ...drawing, documentId: "child" };
    expect(bridge.state()?.dirty).toHaveLength(1);
  });
});
