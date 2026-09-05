import type { CircuitProject } from "@icm/model";
import { SimulationFiles } from "@icm/simulation-service/files";
import type {
  SimulationOperation,
  SimulationReply,
} from "@icm/simulation-service/contract";
import type { SimulationService } from "@icm/simulation-service";

export interface BrowserSimulationSessionOptions {
  getProjectSessionId(): string;
  getProject(): CircuitProject;
  files?: SimulationFiles;
  fetch?: typeof fetch;
}

/** Shared browser composition, not a second run registry. Each owner has an
 * isolated scope; revoking an Agent cannot cancel the human owner's run. */
export class BrowserSimulationSession {
  readonly files: SimulationFiles;
  private service: Promise<SimulationService> | undefined;
  private generation = 0;
  private readonly projectSessionId: string;
  constructor(private options: BrowserSimulationSessionOptions) {
    this.projectSessionId = options.getProjectSessionId();
    this.files = options.files ?? new SimulationFiles();
  }
  async clear() {
    this.generation++;
    const service = this.service;
    this.service = undefined;
    if (!this.options.files) this.files.clear();
    await service?.then(
      (value) => value.clear(),
      () => {},
    );
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
      this.service ??= import("@icm/simulation-service").then(
        ({ SimulationService, createHostedExecutor }) =>
          new SimulationService(
            this.files,
            createHostedExecutor(
              this.options.fetch ?? ((...args) => globalThis.fetch(...args)),
            ),
            this.options.getProject,
          ),
      );
      const service = await this.service;
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
      return await service.handle(operation, requestId);
    } catch {
      this.service = undefined;
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
