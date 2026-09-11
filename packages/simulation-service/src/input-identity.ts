import type {
  CircuitProject,
  ProjectSimulationSetup,
  SimulationRunVariant,
} from "@icm/model";
import { compileSourceSimulation } from "@icm/netlist";
import { sha256 } from "./content-digest.js";

/** Authored/electrical identity is separate from the resolved runtime's prepared digest. */
export function sourceInputRevision(
  setup: ProjectSimulationSetup,
  compiled: Extract<ReturnType<typeof compileSourceSimulation>, { ok: true }>,
) {
  return sha256(
    JSON.stringify({
      source: setup.input,
      electricalHash: compiled.electricalHash,
      files: compiled.files,
      outputs: compiled.outputs,
      deviceOperatingPoints: compiled.deviceOperatingPoints,
      environment: compiled.config.environment,
    }),
  );
}

/** One session, one Project revision cache; pure compilation, never an executor call. */
export class ProjectInputIdentity {
  private revision: string | undefined;
  private pending = new Map<string, Promise<string | null>>();
  clear() {
    this.revision = undefined;
    this.pending.clear();
  }
  read(
    project: CircuitProject,
    setupId: string,
    variant?: SimulationRunVariant,
  ): Promise<string | null> {
    // Document edits (including W/L) need not advance structureRevision.
    const revision = JSON.stringify([
      project.id,
      project.structureRevision,
      project.documents.map((d) => [d.id, d.revision]),
    ]);
    if (revision !== this.revision) {
      this.pending.clear();
      this.revision = revision;
    }
    const key = JSON.stringify([setupId, variant ?? null]);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const setup = project.simulationSetups.find((item) => item.id === setupId);
    if (!setup) return Promise.resolve(null);
    const compiled = compileSourceSimulation(project, setup, variant);
    const reading = compiled.ok
      ? sourceInputRevision(setup, compiled)
      : Promise.resolve(null);
    this.pending.set(key, reading);
    void reading.catch(() => {
      if (this.pending.get(key) === reading) this.pending.delete(key);
    });
    return reading;
  }
}
