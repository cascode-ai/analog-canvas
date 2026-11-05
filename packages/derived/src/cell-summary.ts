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
  return project.documents.map((cell) => ({
    id: cell.id,
    name: cell.name,
    isTop: cell.id === project.topDocumentId,
    portCount: projectCellInterface(cell.netlist).ports.length,
    callers: project.documents.flatMap((parent) =>
      parent.instances.flatMap((instance) => {
        const binding = instance.netlist?.binding;
        return binding?.kind === "subcircuit" &&
          binding.childDocumentId === cell.id
          ? [
              {
                documentId: parent.id,
                documentName: parent.name,
                instanceId: instance.id,
              },
            ]
          : [];
      }),
    ),
  }));
}
