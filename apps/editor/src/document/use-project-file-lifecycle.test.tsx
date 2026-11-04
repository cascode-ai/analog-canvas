// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { CURRENT_PROJECT_FILE_VERSION } from "@icm/project-protocol";
import {
  createGalleryExampleCommands,
  type GalleryEntryContext,
} from "../features/editor-shell/gallery-example-commands";
import type { CloudProjectSaveOutcome } from "../features/editor-shell/cloud-projects";
import type { CloudProjectStore } from "../services/editor-services";
import {
  EditorDocumentController,
  useDocumentController,
} from "./document-controller";
import {
  useProjectFileLifecycle,
  type UseProjectFileLifecycleOptions,
} from "./use-project-file-lifecycle";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const view = { x: 0, y: 0, width: 1000, height: 800 };
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function project(name = "A") {
  const result = createEmptyProject(name, name, "main");
  for (let i = 0; i < 3; i++)
    result.documents[0]!.instances.push({
      id: `r${i}`,
      reference: `R${i + 1}`,
      symbolId: "resistor",
      placement: {
        position: { x: i * 100, y: 0 },
        rotation: 0,
        mirror: "none",
      },
    });
  return result;
}

function cloudStore(save: CloudProjectStore["save"]): CloudProjectStore {
  return {
    kind: "cloud",
    limit: 20,
    save,
    list: vi.fn(),
    open: vi.fn(),
    delete: vi.fn(),
  };
}

async function mount(
  store: CloudProjectStore | null = null,
  fetchImpl: typeof fetch = vi.fn(),
) {
  const initial = project();
  const recovery: UseProjectFileLifecycleOptions["recovery"] = {
    workingCopyId: "working-copy",
    ready: false,
    sessions: [],
    stage: vi.fn(),
    cancelPending: vi.fn(),
    flushNow: async () => "stored",
    beginWorkingCopy: vi.fn(),
    noteFormalFileHint: vi.fn(),
    discover: async () => {},
    readSessionProject: vi.fn(),
    deleteSession: async () => true,
  };
  let current!: {
    doc: ReturnType<typeof useDocumentController>;
    file: ReturnType<typeof useProjectFileLifecycle>;
    commands: ReturnType<typeof createGalleryExampleCommands>;
  };
  const statuses: string[] = [];
  let pendingEdits = false;
  let openBlocker: string | null = null;
  function Harness() {
    const doc = useDocumentController(initial, () => {});
    const file = useProjectFileLifecycle({
      projectStore: store,
      project: doc.project,
      projectSessionId: doc.projectSessionId,
      viewBox: view,
      defaultViewBox: view,
      recovery,
      beforeSnapshot: async () => doc.controller.project,
      hasPendingEdits: () => pendingEdits,
      describeOpenBlocker: () => openBlocker,
      installProject: (next) => doc.replaceProject(next),
      setStatus: (message) => statuses.push(message),
      onCloudProjectSaved: () => {},
    });
    const commands = createGalleryExampleCommands({
      defaultViewBox: view,
      replaceActiveProject: file.replaceActiveProject,
      captureRefreshTarget: file.captureReplacementTarget,
      guardDirtyReplacement: file.guardDirtyReplacement,
      beginCopyPlacement: () => {},
      cancelAllTransientInteraction: () => {},
      setGalleryEntryContext: () => {},
      setDailyOpenLimit: () => {},
      setStatus: (message) => statuses.push(message),
      fetchImpl,
    });
    current = { doc, file, commands };
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Harness)));
  return {
    get current() {
      return current;
    },
    statuses,
    setPendingEdits(value: boolean) {
      pendingEdits = value;
    },
    setOpenBlocker(value: string) {
      openBlocker = value;
    },
    async rename(name: string) {
      await act(async () => {
        const next = structuredClone(current.doc.project);
        next.name = name;
        next.structureRevision++;
        current.doc.commitProjectStructure(next);
      });
    },
    async guard() {
      await act(async () =>
        current.file.guardDirtyReplacement("Open B", () => {
          current.file.replaceActiveProject(project("B"));
        }),
      );
      expect(current.file.replaceGuard).not.toBeNull();
    },
  };
}

const saved: CloudProjectSaveOutcome = {
  status: "saved",
  project: {
    id: "cloud-A",
    revision: 1,
    name: "A",
    galleryEntryId: null,
    schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    updatedAt: "2026-11-04T00:00:00Z",
  },
};

it("keeps edits made during Save and continue, and can save them on retry", async () => {
  const response = deferred<CloudProjectSaveOutcome>();
  const written: CircuitProject[] = [];
  const editor = await mount(
    cloudStore(async (snapshot) => {
      written.push(snapshot);
      return written.length === 1 ? response.promise : saved;
    }),
  );
  await editor.rename("Before save");
  await editor.guard();
  await act(async () => editor.current.file.saveAndContinueReplaceGuard());
  await editor.rename("Edited while saving");
  await act(async () => {
    response.resolve(saved);
  });
  expect(editor.current.doc.project.name).toBe("Edited while saving");
  expect(editor.current.file.hasUnsavedChanges()).toBe(true);
  expect(editor.current.file.replaceGuard).not.toBeNull();
  expect(editor.statuses.at(-1)).toContain("newer edits remain unsaved");
  await act(async () => editor.current.file.saveAndContinueReplaceGuard());
  expect(written.at(-1)?.name).toBe("Edited while saving");
  expect(editor.current.doc.project.name).toBe("B");
  expect(editor.current.file.replaceGuard).toBeNull();
});

it.each(["switch", "edit", "replace", "unapplied code draft"])(
  "ignores Gallery refresh after %s",
  async (action) => {
    const response = deferred<Response>();
    const editor = await mount(null, () => response.promise);
    const oldController = editor.current.doc.controller;
    const context: GalleryEntryContext = {
      id: "gallery-A",
      projectId: "A",
      name: "A",
      ownerUserId: null,
      author: "",
      description: "",
      tags: [],
    };
    let refreshing!: Promise<void>;
    await act(async () => {
      refreshing = editor.current.commands.refreshGalleryEntry(context);
    });
    if (action === "switch") {
      await act(async () => {
        editor.current.doc.activateSession(
          new EditorDocumentController(project("B")),
        );
        editor.current.file.restoreFileSession({
          persistenceState: "dirty",
          cloudBinding: { id: "cloud-B", revision: 7 },
          savedBaseline: null,
          safeSnapshotToken: null,
        });
      });
    } else if (action === "edit") {
      await editor.rename("Edited A");
    } else if (action === "unapplied code draft") {
      editor.setOpenBlocker("a code panel holds a draft that is not applied");
    } else {
      await act(async () => {
        editor.current.file.replaceActiveProject(project("B"));
      });
    }
    const before = editor.current.doc.project;
    const fileBefore = editor.current.file.captureFileSession();
    const oldBefore = oldController.project;
    await act(async () => {
      response.resolve(
        new Response(
          JSON.stringify({
            projectText: serializeProject(project("Updated A")),
          }),
        ),
      );
      await refreshing;
    });
    expect(editor.current.doc.project).toEqual(before);
    expect(oldController.project).toEqual(oldBefore);
    expect(editor.current.file.captureFileSession()).toEqual(fileBefore);
    expect(editor.current.file.replaceGuard).toBeNull();
  },
);

it("is clean after Undo to saved content and dirty again after Redo", async () => {
  const editor = await mount(cloudStore(async () => saved));
  await act(async () => {
    await editor.current.file.saveProjectToCloud();
  });
  expect(editor.current.file.hasUnsavedChanges()).toBe(false);
  await editor.rename("Edited");
  expect(editor.current.file.hasUnsavedChanges()).toBe(true);
  await act(async () => {
    editor.current.doc.transact([{ kind: "undo" }]);
  });
  expect(editor.current.doc.project.name).toBe("A");
  expect(editor.current.file.persistenceState).toBe("clean");
  expect(editor.current.file.hasUnsavedChanges()).toBe(false);
  await act(async () => {
    editor.current.doc.transact([{ kind: "redo" }]);
  });
  expect(editor.current.doc.project.name).toBe("Edited");
  expect(editor.current.file.hasUnsavedChanges()).toBe(true);
});

it.each(["draft", "switch"])(
  "does not continue a Cloud save after a new %s",
  async (change) => {
    const response = deferred<CloudProjectSaveOutcome>();
    const editor = await mount(cloudStore(() => response.promise));
    await editor.rename("Unsaved A");
    await editor.guard();
    await act(async () => editor.current.file.saveAndContinueReplaceGuard());
    if (change === "draft") editor.setPendingEdits(true);
    else
      await act(async () => {
        editor.current.doc.activateSession(
          new EditorDocumentController(project("C")),
        );
        editor.current.file.restoreFileSession({
          persistenceState: "dirty",
          cloudBinding: { id: "cloud-C", revision: 4 },
          savedBaseline: null,
          safeSnapshotToken: null,
        });
      });
    await act(async () => {
      response.resolve(saved);
    });
    expect(editor.current.doc.project.name).toBe(
      change === "draft" ? "Unsaved A" : "C",
    );
    expect(editor.current.file.hasUnsavedChanges()).toBe(true);
    if (change === "switch")
      expect(editor.current.file.cloudBinding?.id).toBe("cloud-C");
  },
);

it("refreshes an untouched Gallery project normally", async () => {
  const editor = await mount(
    null,
    async () =>
      new Response(
        JSON.stringify({
          projectText: serializeProject(project("Updated A")),
        }),
      ),
  );
  await act(async () =>
    editor.current.commands.refreshGalleryEntry({
      id: "gallery-A",
      projectId: "A",
      name: "A",
      ownerUserId: null,
      author: "",
      description: "",
      tags: [],
    }),
  );
  expect(editor.current.doc.project.name).toBe("Updated A");
  expect(editor.current.file.hasUnsavedChanges()).toBe(false);
});
