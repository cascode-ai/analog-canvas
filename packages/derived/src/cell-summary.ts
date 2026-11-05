import { projectHierarchyCalls } from "./project-hierarchy.js";
import type { CircuitProject } from "@icm/model";
import { projectCellInterface } from "@icm/model";

export interface CellCallerSummary {
  readonly documentId: string;
  readonly documentName: string;
  readonly instanceId: string;
}

export interface ProjectCellSummary {
  readonly id: string;
  readonly name: string;
  readonly isTop: boolean;
  readonly portCount: number;
  readonly callers: readonly CellCallerSummary[];
}

/** Read-only hierarchy inventory shared by management and future Agent views. */
export function summarizeProjectCells(
  project: CircuitProject,
): readonly ProjectCellSummary[] {
  const calls = projectHierarchyCalls(project);
  const names = new Map(project.documents.map((cell) => [cell.id, cell.name]));
  return project.documents.map((cell) => ({
    id: cell.id,
    name: cell.name,
    isTop: cell.id === project.topDocumentId,
    portCount: projectCellInterface(cell.netlist).ports.length,
    callers: calls
      .filter((call) => call.childDocumentId === cell.id)
      .map((call) => ({
        documentId: call.parentDocumentId,
        documentName: names.get(call.parentDocumentId)!,
        instanceId: call.instanceId,
      })),
  }));
}
