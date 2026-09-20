import type {
  Prepared,
  Run,
  SimulationReply,
} from "@icm/simulation-service/contract";
import type { SimulationFiles } from "@icm/simulation-service/files";
import type { BrowserSimulationArchiveStore } from "./browser-simulation-archive-store";
import type {
  SimulationArchivePresentation,
  SimulationRunArchiveSummary,
  SimulationRunArchiveV1,
} from "./simulation-run-archive";

export interface ProjectRunRecord {
  id: string;
  owner: "agent" | "human";
  presentation: SimulationArchivePresentation;
  state: Run["state"];
  archive?: SimulationRunArchiveSummary;
  /** Only retained when persistence fails; durable history holds metadata. */
  memoryArchive?: SimulationRunArchiveV1;
  error?: string;
}

/** Project-scoped read-only result handoff. Execution/cancellation stays with
 * the originating session; this registry never exposes its service to GUI. */
export class ProjectRunHistory {
  private records = new Map<string, ProjectRunRecord>();
  private listeners = new Set<() => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;
  constructor(
    readonly projectId: string,
    private store?: BrowserSimulationArchiveStore,
  ) {}
  snapshot = (): readonly ProjectRunRecord[] => [...this.records.values()];
  /** React StrictMode replays mount effects before any user-owned run starts. */
  activate() {
    this.disposed = false;
  }
  forgetArchive(archiveId: string) {
    for (const record of this.records.values()) {
      if (record.archive?.id === archiveId) this.records.delete(record.id);
    }
    this.notify();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify() {
    for (const listener of this.listeners) listener();
  }
  track(input: {
    owner: "agent" | "human";
    prepared: Prepared;
    presentation: SimulationArchivePresentation;
    run: Run;
    files: SimulationFiles;
    read(): Promise<SimulationReply>;
    active(): boolean;
    projectFile?: string;
  }) {
    if (this.disposed || this.records.has(input.run.id)) return;
    const record: ProjectRunRecord = {
      id: input.run.id,
      owner: input.owner,
      presentation: structuredClone(input.presentation),
      state: input.run.state,
      ...(input.projectFile === ""
        ? {
            error:
              "Project changed during preparation; only the executed-input artifacts and results are retained",
          }
        : {}),
    };
    this.records.set(record.id, record);
    this.notify();
    const update = async (run: Run): Promise<void> => {
      if (this.disposed) return;
      record.state = run.state;
      this.notify();
      if (["finished", "cancelled", "lost", "failed"].includes(run.state)) {
        if (!run.result && !run.outputData) {
          record.error =
            run.error?.message ?? "Run ended without result artifacts";
          this.notify();
          return;
        }
        // The registry is created with the editor, but archive codecs and disk
        // storage are needed only after a run produces evidence.
        const [
          {
            captureSimulationRunArchive,
            MAX_SIMULATION_ARCHIVE_BYTES,
            summarizeSimulationRunArchive,
          },
          { createBrowserSimulationArchiveStore },
        ] = await Promise.all([
          import("./simulation-run-archive"),
          import("./browser-simulation-archive-store"),
        ]);
        if (this.disposed) return;
        this.store ??= createBrowserSimulationArchiveStore();
        const captured = await captureSimulationRunArchive(input.files, {
          projectId: this.projectId,
          presentation: { ...input.presentation, origin: input.owner },
          prepared: input.prepared,
          run,
        });
        if (this.disposed) return;
        if (!captured.ok) record.error = captured.error.message;
        else {
          const byteLength =
            captured.value.byteLength +
            new TextEncoder().encode(input.projectFile ?? "").byteLength;
          const archive: SimulationRunArchiveV1 = {
            ...captured.value,
            id: `run-${run.id}`,
            ...(input.projectFile && byteLength <= MAX_SIMULATION_ARCHIVE_BYTES
              ? { projectFile: input.projectFile, byteLength }
              : {}),
          };
          if (input.projectFile && byteLength > MAX_SIMULATION_ARCHIVE_BYTES)
            record.error =
              "Project snapshot exceeds the archive size limit; result-only export is available";
          const saved = await this.store.save(archive);
          record.archive = summarizeSimulationRunArchive(archive);
          if (!saved.ok) {
            record.memoryArchive = archive;
            record.error = `Result available for this session only: ${saved.message}`;
          }
        }
        this.notify();
        return;
      }
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (this.disposed) return;
        if (!input.active()) {
          record.error = "Run owner disconnected before result handoff";
          record.state = "lost";
          this.notify();
          return;
        }
        void input
          .read()
          .then((reply) => {
            if (reply.ok && "run" in reply) return update(reply.run);
            record.state = "lost";
            record.error = reply.ok
              ? "Run response missing"
              : reply.error.message;
            this.notify();
          })
          .catch((error: unknown) => {
            record.state = "lost";
            record.error = String(error);
            this.notify();
          });
      }, 500);
      this.timers.add(timer);
    };
    void update(input.run).catch((error: unknown) => {
      record.error = `Result archive failed: ${String(error)}`;
      this.notify();
    });
  }
  dispose() {
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.listeners.clear();
    this.store?.close();
  }
}
