import type { CircuitProject } from "@icm/model";
import { compileStructuredSimulation } from "@icm/netlist";
import { sha256 } from "./files.js";

type RawSimulationInput = Extract<
  CircuitProject["simulationSetups"][number]["input"],
  { kind: "raw" }
>;
export async function rawInputRevision(input: RawSimulationInput) {
  return sha256(
    JSON.stringify({
      kind: input.kind,
      entry: input.entry,
      files: input.files,
      dependencies: input.dependencies,
      environment: input.environment,
    }),
  );
}

/** One session, one revision cache. Layout-only changes do not compile again. */
export class ProjectInputIdentity {
  private revision: number | undefined;
  private pending = new Map<string, Promise<string | null>>();
  clear() {
    this.revision = undefined;
    this.pending.clear();
  }
  read(project: CircuitProject, setupId: string): Promise<string | null> {
    if (project.structureRevision !== this.revision) {
      this.pending.clear();
      this.revision = project.structureRevision;
    }
    const existing = this.pending.get(setupId);
    if (existing) return existing;
    const snapshot = structuredClone(project);
    const reading = (async () => {
      const setup = snapshot.simulationSetups.find((s) => s.id === setupId);
      if (!setup) return null;
      if (setup.input.kind === "raw") return rawInputRevision(setup.input);
      const compiled = await compileStructuredSimulation(snapshot, setup);
      return compiled.ok ? (compiled.request.inputRevision ?? null) : null;
    })();
    this.pending.set(setupId, reading);
    void reading.catch(() => {
      if (this.pending.get(setupId) === reading) this.pending.delete(setupId);
    });
    return reading;
  }
}
