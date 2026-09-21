import type {
  CircuitProject,
  ProjectSimulationFolder,
  SimulationRunVariant,
} from "@icm/model";
import {
  compileSourceSimulation,
  compileNgspiceSourceSimulation,
} from "@icm/netlist";
import { sha256 } from "./content-digest.js";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => (item === undefined ? "null" : canonicalJson(item)))
      .join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Authored/electrical identity is separate from the resolved runtime's prepared digest. */
export function sourceInputRevision(
  folder: ProjectSimulationFolder,
  compiled: Pick<
    Extract<ReturnType<typeof compileSourceSimulation>, { ok: true }>,
    "electricalHash" | "files" | "outputs" | "deviceOperatingPoints" | "config"
  >,
) {
  return sha256(
    canonicalJson({
      source: folder.input,
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
    folderId: string,
    variant?: SimulationRunVariant,
    engine: "ngspice" | "vacask" = "vacask",
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
    const key = JSON.stringify([folderId, variant ?? null, engine]);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const folder = project.simulationFolders.find(
      (item) => item.id === folderId,
    );
    if (!folder) return Promise.resolve(null);
    const compiled =
      engine === "ngspice"
        ? compileNgspiceSourceSimulation(project, folder, variant)
        : compileSourceSimulation(project, folder, variant);
    const reading = compiled.ok
      ? sourceInputRevision(folder, compiled)
      : Promise.resolve(null);
    this.pending.set(key, reading);
    void reading.catch(() => {
      if (this.pending.get(key) === reading) this.pending.delete(key);
    });
    return reading;
  }
}
