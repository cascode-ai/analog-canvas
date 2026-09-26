import { afterEach, expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";
import { captureProjectSaveSnapshot } from "../document/project-save-coordinator";
import {
  openNativeFile,
  saveBackgroundNativeTab,
  saveNativeWorkspace,
} from "./native-project-workspace";
import type {
  NativeProjectStore,
  NativeSaveOutcome,
} from "./native-project-store";

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    callback();
    return 1;
  });
  const file = {
    id: "grant",
    revision: 1,
    name: "a.icproj.json",
    path: "C:/a.icproj.json",
  };
  const project = createEmptyProject("project", "Project", "top");
  const entries: ReturnType<
    Parameters<typeof saveBackgroundNativeTab>[1]["entries"]
  > = [
    {
      id: "tab",
      session: {
        controller: { project, projectSessionId: "session" },
        file: {
          nativeBinding: file,
          cloudBinding: null,
          savedBaseline: null,
          safeSnapshotToken: null,
          persistenceState: "dirty",
        },
        view: { x: 0, y: 0, width: 100, height: 100 },
        dirty: true,
        unsafe: true,
      },
    },
  ];
  const store: NativeProjectStore = {
    save: vi.fn(async () => ({
      status: "saved" as const,
      file: { ...file, revision: 2 },
    })),
    open: vi.fn(async () => ({ status: "opened" as const, file, text: "{}" })),
    recent: vi.fn(async () => []),
    forget: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
  const tabs = {
    entries: () => entries,
    changed: vi.fn(),
    select: vi.fn(async () => true),
    open: vi.fn(async () => false),
    report: vi.fn(),
  };
  return { file, project, entries, store, tabs };
}

it("background save acknowledges only its snapshot and retains newer edits", async () => {
  const f = fixture();
  let done!: (result: NativeSaveOutcome) => void;
  const save = vi.fn(
    () =>
      new Promise<NativeSaveOutcome>((resolve) => {
        done = resolve;
      }),
  );
  f.store.save = save;
  const pending = saveBackgroundNativeTab(
    f.store,
    f.tabs,
    "tab",
    captureProjectSaveSnapshot,
  );
  f.project.name = "Newer edit";
  f.project.structureRevision += 1;
  done({ status: "saved", file: { ...f.file, revision: 2 } });
  await pending;
  expect(f.entries[0]!.session.file.savedBaseline?.project.name).toBe(
    "Project",
  );
  expect(f.entries[0]!.session.dirty).toBe(true);
  expect(f.entries[0]!.session.file.nativeBinding?.revision).toBe(2);
  expect(f.tabs.changed).toHaveBeenCalledOnce();
});

it("does not acknowledge a save into a replaced background session", async () => {
  const f = fixture();
  f.store.save = async () => {
    f.entries[0]!.session.controller.projectSessionId = "replacement";
    return { status: "saved", file: { ...f.file, revision: 2 } };
  };
  await saveBackgroundNativeTab(
    f.store,
    f.tabs,
    "tab",
    captureProjectSaveSnapshot,
  );
  expect(f.tabs.changed).not.toHaveBeenCalled();
  expect(f.entries[0]!.session.file.savedBaseline).toBeNull();
});

it("selects an already open file without granting another tab ownership", async () => {
  const f = fixture();
  await openNativeFile(f.store, f.tabs);
  expect(f.tabs.select).toHaveBeenCalledWith("tab");
  expect(f.tabs.open).not.toHaveBeenCalled();
  expect(f.store.release).not.toHaveBeenCalled();
});

it("releases a new grant when opening its Project is rejected", async () => {
  const f = fixture();
  f.entries.length = 0;
  await openNativeFile(f.store, f.tabs);
  expect(f.tabs.open).toHaveBeenCalledOnce();
  expect(f.store.release).toHaveBeenCalledWith(f.file.id);
});

it("cancellation stops Save all and clears the workspace busy state", async () => {
  fixture();
  const save = vi.fn(async () => ({ status: "cancelled" as const }));
  const busy = vi.fn();
  expect(
    await saveNativeWorkspace(
      () => ({
        busy: false,
        pendingEdits: false,
        dirty: [{ id: "first" }, { id: "second" }],
      }),
      save,
      busy,
    ),
  ).toEqual({ status: "cancelled" });
  expect(save).toHaveBeenCalledTimes(1);
  expect(busy.mock.calls).toEqual([[true], [false]]);
});

it("retains a successful open grant before React renders the new tab", async () => {
  const f = fixture();
  f.entries.length = 0;
  f.tabs.open.mockResolvedValue(true);
  await openNativeFile(f.store, f.tabs);
  expect(f.store.release).not.toHaveBeenCalled();
});
