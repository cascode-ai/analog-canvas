// Decision assertions adapted from the fork's close-guard tests; see SOURCES.md.
import { describe, expect, it, vi } from "vitest";
import {
  decideClose,
  workspaceCloseState,
  type CloseGuardPorts,
} from "./close-guard.js";
const clean = { dirty: [], busy: false, pendingEdits: false };
const dirty = {
  ...clean,
  dirty: [{ id: "background", name: "Background Project" }],
};
const ports = (): CloseGuardPorts => ({
  readState: vi.fn(async () => dirty),
  ask: vi.fn(async () => "cancel" as const),
  save: vi.fn(async () => ({ status: "saved" })),
  reportFailure: vi.fn(async () => {}),
});
describe("all-tab native close guard", () => {
  it("closes a clean workspace without prompting", async () => {
    const p = ports();
    p.readState = vi.fn(async () => clean);
    expect(await decideClose(p)).toBe("close");
    expect(p.ask).not.toHaveBeenCalled();
  });
  it("asks about background work and cancellation retains it", async () => {
    const p = ports();
    expect(await decideClose(p)).toBe("stay");
    expect(p.ask).toHaveBeenCalledWith(dirty);
  });
  it("requires explicit discard when the renderer is unavailable", async () => {
    const p = ports();
    p.readState = vi.fn(async () => null);
    expect(await decideClose(p)).toBe("stay");
    p.ask = vi.fn(async () => "discard" as const);
    expect(await decideClose(p)).toBe("close");
  });
  it.each(["cancelled", "failed", "conflict"])(
    "retains the window after %s Save",
    async (status) => {
      const p = ports();
      p.ask = vi.fn(async () => "save" as const);
      p.save = vi.fn(async () => ({ status, message: "not written" }));
      expect(await decideClose(p)).toBe("stay");
    },
  );
  it("rechecks after Save so newer edits cannot be discarded", async () => {
    const p = ports();
    p.ask = vi.fn(async () => "save" as const);
    expect(await decideClose(p)).toBe("stay");
    p.readState = vi
      .fn()
      .mockResolvedValueOnce(dirty)
      .mockResolvedValueOnce(clean);
    expect(await decideClose(p)).toBe("close");
  });
  it.each(["busy", "pendingEdits"] as const)(
    "keeps %s work before opening any decision",
    async (flag) => {
      const p = ports();
      p.readState = vi.fn(async () => ({ ...clean, [flag]: true }));
      expect(await decideClose(p)).toBe("stay");
      expect(p.ask).not.toHaveBeenCalled();
    },
  );
  it("treats malformed state as unavailable", () => {
    expect(workspaceCloseState({ dirty: false })).toBeNull();
    expect(workspaceCloseState({ ...clean, dirty: [null] })).toBeNull();
  });
});
