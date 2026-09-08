import type { CircuitProject } from "@icm/model";
import { compileStructuredSimulation } from "@icm/netlist";
import { sha256 } from "./files.js";
import {
  projectSimulationVariant,
  type SimulationProjectVariant,
} from "./project-variant.js";

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
  read(
    project: CircuitProject,
    setupId: string,
    variant?: SimulationProjectVariant,
  ): Promise<string | null> {
    if (project.structureRevision !== this.revision) {
      this.pending.clear();
      this.revision = project.structureRevision;
    }
    const cacheKey = `${setupId}:${JSON.stringify(variant ?? null)}`;
    const existing = this.pending.get(cacheKey);
    if (existing) return existing;
    const snapshot = structuredClone(project);
    const reading = (async () => {
      const projected = projectSimulationVariant(snapshot, setupId, variant);
      if (!projected.ok) return null;
      const { project: projectedProject, setup } = projected;
      if (setup.input.kind === "raw") return rawInputRevision(setup.input);
      const compiled = await compileStructuredSimulation(
        projectedProject,
        setup,
      );
      return compiled.ok ? (compiled.request.inputRevision ?? null) : null;
    })();
    this.pending.set(cacheKey, reading);
    void reading.catch(() => {
      if (this.pending.get(cacheKey) === reading) this.pending.delete(cacheKey);
    });
    return reading;
  }
}
