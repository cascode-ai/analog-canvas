import type { CircuitProject } from "@icm/model";
import { SimulationFiles } from "@icm/simulation-service/files";
import type { ProjectSimulationFileHost } from "@icm/simulation-service/files";
import type {
  SimulationOperation,
  SimulationReply,
} from "@icm/simulation-service/contract";
import type { SimulationService } from "@icm/simulation-service";
import type { Prepared } from "@icm/simulation-service/contract";
import type { ProjectRunHistory } from "./project-run-history";
import type { sourcePresentation } from "./source-presentation";
import { serializeProject } from "@icm/project-protocol";
import { simulationFileEngine } from "./file-engine";
import { createBrowserSimulationArtifactStore } from "./browser-simulation-artifact-store";

/** Do not export a pre-prepare Project when editing raced with compilation. */
export function unchangedProjectSnapshot(
  before: CircuitProject,
  after: CircuitProject,
): string {
  const file = serializeProject(before);
  return file === serializeProject(after) ? file : "";
}

export interface BrowserSimulationSessionOptions {
  runHistory?: ProjectRunHistory;
  owner?: "agent" | "human";
  getProjectSessionId(): string;
  getProject(): CircuitProject;
  files?: SimulationFiles;
  projectFiles?: ProjectSimulationFileHost;
  fetch?: typeof fetch;
  /** Explicit deployment composition; never inferred after a start fails. */
  transport?: "direct" | "managed";
}

/** Shared browser composition, not a second run registry. Each owner has an
 * isolated scope; revoking an Agent cannot cancel the human owner's run. */
export class BrowserSimulationSession {
  readonly files: SimulationFiles;
  private service: Promise<SimulationService> | undefined;
  private generation = 0;
  private batchPolls = new Map<string, ReturnType<typeof setTimeout>>();
  private presentations = new Map<
    string,
    {
      prepared: Prepared;
      presentation: ReturnType<typeof sourcePresentation>;
      projectFile: string;
    }
  >();
  private readonly projectSessionId: string;
  constructor(private options: BrowserSimulationSessionOptions) {
    this.projectSessionId = options.getProjectSessionId();
    this.files =
      options.files ??
      new SimulationFiles(
        Date.now,
        options.projectFiles,
        simulationFileEngine(options),
        createBrowserSimulationArtifactStore(
          options.getProject().id,
          undefined,
          { retainSession: true },
        ),
      );
  }
  async clear() {
    this.generation++;
    this.presentations.clear();
    for (const timer of this.batchPolls.values()) clearTimeout(timer);
    this.batchPolls.clear();
    const service = this.service;
    this.service = undefined;
    if (!this.options.files) this.files.clear();
    await service?.then(
      (value) => value.clear(),
      () => {},
    );
  }
  /** Read the current controller state after an awaited File Resource commit. */
  currentProject(): CircuitProject | undefined {
    return this.options.getProjectSessionId() === this.projectSessionId
      ? this.options.getProject()
      : undefined;
  }
  async handle(
    operation: SimulationOperation,
    requestId: string = crypto.randomUUID(),
  ): Promise<SimulationReply> {
    const generation = this.generation;
    if (this.options.getProjectSessionId() !== this.projectSessionId)
      return {
        ok: false,
        error: {
          code: "PROJECT_REPLACED",
          message: "The bound Project changed",
          stage: "input",
          recovery: "reauthorize",
        },
      };
    try {
      this.service ??= import("@icm/simulation-service")
        .then(
          ({
            SimulationService,
            createHostedExecutor,
            createManagedHostedExecutor,
          }) =>
            new SimulationService(
              this.files,
              this.options.transport === "managed"
                ? createManagedHostedExecutor({
                    fetch:
                      this.options.fetch ??
                      ((...args) => globalThis.fetch(...args)),
                  })
                : createHostedExecutor(
                    this.options.fetch ??
                      ((...args) => globalThis.fetch(...args)),
                  ),
              this.options.getProject,
            ),
        )
        .catch((error: unknown) => {
          if (generation === this.generation) this.service = undefined;
          throw error;
        });
      const [service, { sourcePresentation }] = await Promise.all([
        this.service,
        import("./source-presentation"),
      ]);
      if (
        generation !== this.generation ||
        this.options.getProjectSessionId() !== this.projectSessionId
      )
        return {
          ok: false,
          error: {
            code: "SESSION_CHANGED",
            message: "Input owner changed during loading",
            stage: "input",
            recovery: "reauthorize",
          },
        };
      const sourceProject =
        (operation.operation === "prepare" ||
          operation.operation === "prepare-batch" ||
          operation.operation === "prepare-sweep") &&
        this.options.runHistory
          ? structuredClone(this.options.getProject())
          : undefined;
      const reply = await service.handle(operation, requestId);
      const projectFile = sourceProject
        ? unchangedProjectSnapshot(sourceProject, this.options.getProject())
        : "";
      if (
        generation === this.generation &&
        this.options.runHistory &&
        reply.ok
      ) {
        if (
          (operation.operation === "prepare-batch" ||
            operation.operation === "prepare-sweep") &&
          "batch" in reply &&
          sourceProject
        ) {
          for (const item of reply.batch.items) {
            const folder = sourceProject.simulationFolders.find(
              (folder) => folder.id === item.folderId,
            );
            if (folder)
              this.presentations.set(item.prepared.id, {
                prepared: item.prepared,
                presentation: {
                  ...sourcePresentation(folder),
                  folderName: item.label ?? folder.name,
                },
                projectFile,
              });
          }
        }
        if (
          operation.operation === "prepare" &&
          operation.source.kind === "project-folder" &&
          "prepared" in reply
        ) {
          const folderId = operation.source.folderId;
          const folder = sourceProject?.simulationFolders.find(
            (item) => item.id === folderId,
          );
          if (folder)
            this.presentations.set(reply.prepared.id, {
              prepared: reply.prepared,
              presentation: sourcePresentation(folder),
              projectFile,
            });
        }
        if (operation.operation === "start" && "run" in reply) {
          const prepared = this.presentations.get(reply.run.preparedId);
          if (prepared)
            this.options.runHistory.track({
              ...prepared,
              owner: this.options.owner ?? "human",
              run: reply.run,
              files: this.files,
              read: () =>
                service.handle(
                  { operation: "read", runId: reply.run.id },
                  crypto.randomUUID(),
                ),
              active: () =>
                generation === this.generation &&
                this.options.getProjectSessionId() === this.projectSessionId,
            });
        }
        if (
          (operation.operation === "start-batch" ||
            operation.operation === "read-batch") &&
          "batch" in reply
        ) {
          for (const item of reply.batch.items) {
            const prepared = this.presentations.get(item.prepared.id);
            if (!item.runId || !prepared) continue;
            const runReply = await service.handle(
              { operation: "read", runId: item.runId },
              crypto.randomUUID(),
            );
            if (!runReply.ok || !("run" in runReply)) continue;
            this.options.runHistory.track({
              ...prepared,
              owner: this.options.owner ?? "human",
              run: runReply.run,
              files: this.files,
              read: () =>
                service.handle(
                  { operation: "read", runId: runReply.run.id },
                  crypto.randomUUID(),
                ),
              active: () =>
                generation === this.generation &&
                this.options.getProjectSessionId() === this.projectSessionId,
            });
          }
          const batchId = reply.batch.id;
          if (
            ["running", "cancelling"].includes(reply.batch.state) &&
            !this.batchPolls.has(batchId)
          ) {
            this.batchPolls.set(
              batchId,
              setTimeout(() => {
                this.batchPolls.delete(batchId);
                if (generation === this.generation)
                  void this.handle({ operation: "read-batch", batchId });
              }, 500),
            );
          }
        }
      }
      return reply;
    } catch {
      return {
        ok: false,
        error: {
          code: "SIMULATION_HOST_UNAVAILABLE",
          message: "Simulation could not load; the editor remains available",
          stage: "read",
          recovery: "retry-after",
        },
      };
    }
  }
}
