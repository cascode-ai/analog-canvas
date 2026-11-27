import type { CircuitProject, SchematicDocument } from "./schema/types.js";

const knownProjects = new WeakSet<CircuitProject>();
const knownCells = new WeakSet<SchematicDocument>();

/** Register only a frozen result whose Cell shapes have been checked. A public receipt detached by JSON fingerprint has weaker provenance. */
export function rememberValidatedCells(project: CircuitProject): void {
  knownProjects.add(project);
  for (const cell of project.documents) knownCells.add(cell);
}

export function isValidatedCell(cell: SchematicDocument): boolean {
  return knownCells.has(cell);
}

export function hasValidatedCells(project: CircuitProject): boolean {
  return knownProjects.has(project);
}
