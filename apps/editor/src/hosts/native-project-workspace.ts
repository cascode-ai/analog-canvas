import type { CircuitProject, GridRect } from "@icm/model";
import type {
  NativeFileBinding,
  NativeProjectStore,
  NativeSaveOutcome,
} from "./native-project-store";
import type {
  ProjectFileSession,
  PersistenceState,
  SavedProjectBaseline,
} from "../document/use-project-file-lifecycle";
import type { RecoveryCoordinator } from "../document/recovery-coordinator";
import type { ProjectSaveSnapshot } from "../document/project-save-coordinator";
import type { captureProjectSaveSnapshot } from "../document/project-save-coordinator";

// Loaded only for desktop file operations, outside the Web's initial payload.
const rendered = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
interface FileTab {
  id: string;
  session: {
    controller: { project: CircuitProject; projectSessionId: string };
    file: ProjectFileSession;
    view: GridRect;
    dirty: boolean;
    unsafe: boolean;
  };
}

export async function openNativeFile(
  store: NativeProjectStore,
  tabs: {
    entries(): FileTab[];
    select(id: string): Promise<boolean>;
    open(
      file: File,
      options: { inTab: true; nativeBinding: NativeFileBinding },
    ): Promise<boolean>;
    report(message: string): void;
  },
  recentId?: string,
) {
  const outcome = await store.open(recentId);
  if (outcome.status === "opened") {
    const existing = tabs
      .entries()
      .find(
        (entry) => entry.session.file.nativeBinding?.id === outcome.file.id,
      );
    if (existing) await tabs.select(existing.id);
    else {
      let applied = false;
      try {
        applied = await tabs.open(new File([outcome.text], outcome.file.name), {
          inTab: true,
          nativeBinding: outcome.file,
        });
      } finally {
        // Ownership follows the completed transition, never render timing.
        if (!applied) await store.release(outcome.file.id);
      }
    }
  } else if (outcome.status !== "cancelled")
    tabs.report(
      `Project not opened: ${outcome.message}. Use Open Project to locate the file.`,
    );
}

export async function saveBackgroundNativeTab(
  store: NativeProjectStore,
  tabs: { entries(): FileTab[]; changed(): void },
  id: string,
  capture: typeof captureProjectSaveSnapshot,
): Promise<NativeSaveOutcome> {
  const entry = tabs.entries().find((item) => item.id === id);
  if (!entry) return { status: "failed", message: "Project tab was closed" };
  const snapshot = capture(
    entry.session.controller.project,
    entry.session.controller.projectSessionId,
    () => {
      const live = tabs.entries().find((item) => item.id === id);
      return live
        ? {
            id: live.session.controller.projectSessionId,
            project: live.session.controller.project,
          }
        : null;
    },
  );
  const outcome = await store.save(
    snapshot.project,
    entry.session.file.nativeBinding ?? null,
  );
  const live = tabs.entries().find((item) => item.id === id);
  if (outcome.status === "saved" && live && snapshot.isCurrent()) {
    live.session.file.nativeBinding = outcome.file;
    live.session.file.savedBaseline = {
      project: snapshot.project,
      viewBox: { ...live.session.view },
    };
    live.session.dirty = live.session.unsafe =
      !snapshot.matchesCurrentProject();
    live.session.file.persistenceState = live.session.dirty ? "dirty" : "clean";
    tabs.changed();
  }
  return outcome;
}

export async function saveNativeWorkspace(
  state: () => {
    busy: boolean;
    pendingEdits: boolean;
    dirty: { id: string }[];
  },
  save: (id: string) => Promise<NativeSaveOutcome>,
  setBusy: (busy: boolean) => void,
): Promise<{ status: string; message?: string }> {
  if (state().busy || state().pendingEdits)
    return {
      status: "failed",
      message:
        "Finish or cancel the current edit or file operation before closing.",
    };
  setBusy(true);
  try {
    for (const { id } of state().dirty) {
      const result = await save(id);
      if (result.status !== "saved") return result;
      await rendered();
    }
    // Main re-reads all tabs: edits made during the save keep the window open.
    return { status: "saved" };
  } finally {
    setBusy(false);
  }
}

export async function saveAndCloseNativeTab(
  id: string,
  ports: {
    busy(): boolean;
    setBusy(value: boolean): void;
    save(id: string): Promise<NativeSaveOutcome>;
    entries(): FileTab[];
    close(id: string): Promise<void>;
    report(message: string): void;
  },
): Promise<boolean> {
  if (ports.busy()) return false;
  ports.setBusy(true);
  try {
    const result = await ports.save(id);
    await rendered();
    if (result.status !== "saved") {
      ports.report(
        result.status === "cancelled" ? "Save cancelled" : result.message,
      );
      return false;
    }
    const live = ports.entries().find((entry) => entry.id === id);
    if (live && (live.session.dirty || live.session.unsafe)) return false;
    ports.setBusy(false);
    await ports.close(id);
    return true;
  } finally {
    ports.setBusy(false);
  }
}

export async function writeNativeProject(
  snapshot: ProjectSaveSnapshot,
  ports: {
    store: NativeProjectStore;
    binding: NativeFileBinding | null;
    previousState: PersistenceState;
    recovery: Pick<RecoveryCoordinator, "stage" | "flushNow">;
    view: GridRect;
    currentProject(): CircuitProject;
    acknowledge(file: NativeFileBinding): void;
    setBaseline(baseline: SavedProjectBaseline): void;
    setState(state: PersistenceState): void;
    report(message: string): void;
  },
  asNew: boolean,
): Promise<NativeSaveOutcome> {
  if (!snapshot.isCurrent())
    return { status: "failed", message: "Project changed before saving" };
  ports.setState("saving");
  ports.recovery.stage(snapshot.project, { unsavedAtSnapshot: true });
  await ports.recovery.flushNow();
  if (!snapshot.isCurrent())
    return { status: "failed", message: "Project changed before saving" };
  const outcome = await ports.store.save(
    snapshot.project,
    ports.binding,
    asNew,
  );
  if (!snapshot.isCurrent()) return outcome;
  if (outcome.status === "saved") {
    ports.acknowledge(outcome.file);
    ports.setBaseline({
      project: snapshot.project,
      viewBox: { ...ports.view },
    });
    const unchanged = snapshot.matchesCurrentProject();
    ports.setState(unchanged ? "clean" : "dirty");
    ports.recovery.stage(ports.currentProject(), {
      unsavedAtSnapshot: !unchanged,
    });
    ports.report(
      outcome.warning ??
        `Saved: ${outcome.file.path}${unchanged ? "" : "; newer edits remain unsaved"}`,
    );
  } else if (outcome.status === "cancelled") {
    ports.setState(
      snapshot.matchesCurrentProject() ? ports.previousState : "dirty",
    );
    ports.report("Save cancelled");
  } else {
    ports.setState(outcome.status === "conflict" ? "conflict" : "failed");
    ports.report(`Save failed: ${outcome.message}`);
  }
  return outcome;
}
