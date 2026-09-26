import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";
import {
  captureProjectSaveSnapshot,
  createProjectSaveCoordinator,
  type ProjectSaveSession,
  type ProjectSaveSnapshot,
} from "./project-save-coordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const project = createEmptyProject("project", "Project", "top");
  let live: ProjectSaveSession | null = { id: "tab-session", project };
  const write = vi.fn(async (_snapshot: ProjectSaveSnapshot) => "saved");
  const failed = vi.fn(
    (error: unknown, current: boolean) =>
      `${current ? "current" : "stale"}: ${String(error)}`,
  );
  return {
    project,
    coordinator: createProjectSaveCoordinator<string>(),
    request: {
      sessionId: "tab-session",
      current: () => live,
      write,
      rejected: (reason: string) => reason,
      failed,
    },
    setLive(next: ProjectSaveSession | null) {
      live = next;
    },
  };
}

describe("shared Project save coordination", () => {
  it("commits drafts before capturing owned bytes and preserves newer edits", async () => {
    const f = fixture();
    const drafts = deferred<typeof f.project | null>();
    const receipt = deferred<string>();
    f.request.write.mockImplementation(() => receipt.promise);
    const saving = f.coordinator.save({
      ...f.request,
      beforeSnapshot: () => drafts.promise,
    });
    expect(f.request.write).not.toHaveBeenCalled();
    f.project.documents[0]!.revision += 1;
    drafts.resolve(f.project);
    await Promise.resolve();
    const snapshot = f.request.write.mock.calls[0]![0];
    expect(snapshot.project).toEqual(f.project);
    expect(snapshot.project).not.toBe(f.project);
    expect(snapshot.matchesCurrentProject()).toBe(true);
    f.project.documents[0]!.revision += 1;
    expect(snapshot.project.documents[0]!.revision).toBe(1);
    expect(snapshot.matchesCurrentProject()).toBe(false);
    receipt.resolve("saved");
    expect(await saving).toBe("saved");
    expect(f.coordinator.isSaving()).toBe(false);
  });

  it("joins repeated Save but rejects Save As while the target is pending", async () => {
    const f = fixture();
    const receipt = deferred<string>();
    f.request.write.mockImplementation(() => receipt.promise);
    const saving = f.coordinator.save(f.request);
    expect(f.coordinator.save(f.request)).toBe(saving);
    expect(await f.coordinator.save({ ...f.request, asNew: true })).toBe(
      "busy",
    );
    expect(f.request.write).toHaveBeenCalledTimes(1);
    receipt.resolve("saved");
    await saving;
    expect(await f.coordinator.save({ ...f.request, asNew: true })).toBe(
      "saved",
    );
    expect(f.request.write).toHaveBeenCalledTimes(2);
  });

  it("does not write rejected drafts or drafts resolved after switching tabs", async () => {
    const f = fixture();
    expect(
      await f.coordinator.save({
        ...f.request,
        beforeSnapshot: async () => null,
      }),
    ).toBe("drafts");
    const drafts = deferred<typeof f.project | null>();
    const saving = f.coordinator.save({
      ...f.request,
      beforeSnapshot: () => drafts.promise,
    });
    f.setLive({ id: "different-tab-session", project: f.project });
    drafts.resolve(f.project);
    expect(await saving).toBe("session-changed");
    expect(f.request.write).not.toHaveBeenCalled();
  });

  it("uses an explicitly checked candidate without committing a second draft", async () => {
    const f = fixture();
    const candidate = structuredClone(f.project);
    const beforeSnapshot = vi.fn(async () => null);
    f.project.structureRevision += 1;
    await f.coordinator.save({ ...f.request, candidate, beforeSnapshot });
    expect(beforeSnapshot).not.toHaveBeenCalled();
    expect(f.request.write.mock.calls[0]![0].project).toEqual(candidate);
    expect(f.request.write.mock.calls[0]![0].matchesCurrentProject()).toBe(
      false,
    );
  });

  it.each(["cancelled", "conflict", "unreachable"])(
    "preserves the host's %s receipt without accepting it as saved",
    async (outcome) => {
      const f = fixture();
      f.request.write.mockResolvedValue(outcome);
      expect(await f.coordinator.save(f.request)).toBe(outcome);
      expect(f.coordinator.isSaving()).toBe(false);
    },
  );

  it.each([false, true])(
    "reports failures with session currency (closed=%s) and releases pending state",
    async (closed) => {
      const f = fixture();
      const receipt = deferred<string>();
      f.request.write.mockImplementation(() => receipt.promise);
      const saving = f.coordinator.save(f.request);
      if (closed) f.setLive(null);
      receipt.reject(new Error("disk or network failure"));
      await saving;
      expect(f.request.failed).toHaveBeenCalledWith(expect.any(Error), !closed);
      expect(f.coordinator.isSaving()).toBe(false);
    },
  );

  it("checks session and content again after every asynchronous host acknowledgement", () => {
    const f = fixture();
    const snapshot = captureProjectSaveSnapshot(
      f.project,
      "tab-session",
      f.request.current,
    );
    expect(snapshot.isCurrent()).toBe(true);
    f.project.structureRevision += 1;
    expect(snapshot.isCurrent()).toBe(true);
    expect(snapshot.matchesCurrentProject()).toBe(false);
    f.setLive(null);
    expect(snapshot.isCurrent()).toBe(false);
    f.setLive({ id: "reopened-same-project", project: snapshot.project });
    expect(snapshot.isCurrent()).toBe(false);
    expect(snapshot.matchesCurrentProject()).toBe(false);
  });
});
