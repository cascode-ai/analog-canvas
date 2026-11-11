import type {
  CircuitProject,
  HierarchyFrame,
  SchematicDocument,
} from "@icm/model";
import {
  designNetlistNetNames,
  type DesignNetlistAnalysisOptions,
} from "@icm/netlist";

type SourceRecord = CircuitProject["source"]["files"][number];

interface ReviewObject {
  kind: "instance" | "net";
  id: string;
  label: string;
  source?: { file: SourceRecord; line: number };
}

export interface ReviewFeedbackTarget {
  projectId: string;
  structureRevision: number;
  cellId: string;
  cellName: string;
  cellRevision: number;
  hierarchyPath: readonly HierarchyFrame[];
  sourceVersion: string;
  objects: readonly ReviewObject[];
}

export interface ReviewNote {
  target: ReviewFeedbackTarget;
  comment: string;
}

/** Capture identities from the selection so subsequent edits can't retarget a note. */
export function reviewFeedbackTarget({
  project,
  cell,
  hierarchyPath,
  sourceVersion,
  instanceIds,
  netIds,
  netName,
  netlistOptions,
}: {
  project: CircuitProject;
  cell: SchematicDocument;
  hierarchyPath: readonly HierarchyFrame[];
  sourceVersion: string;
  instanceIds: readonly string[];
  netIds: readonly string[];
  netName(id: string): string | undefined;
  netlistOptions?: Pick<
    DesignNetlistAnalysisOptions,
    "format" | "namingProfile"
  >;
}): ReviewFeedbackTarget {
  const instances = new Set(instanceIds);
  const nets = new Set(netIds);
  const objects: ReviewObject[] = [];
  for (const instance of cell.instances) {
    if (!instances.has(instance.id)) continue;
    const cellPin = cell.netlist?.terminals.find(({ interfaceInstanceIds }) =>
      interfaceInstanceIds.includes(instance.id),
    );
    const object: ReviewObject = {
      kind: "instance",
      id: instance.id,
      label: cellPin
        ? `Pin ${cellPin.name}`
        : (instance.reference ?? instance.symbolId),
    };
    const reference = instance.sourceRef;
    if (reference) {
      const file = project.source.files.find(
        ({ id }) => id === reference.fileId,
      );
      if (file?.hash.startsWith("sha256:"))
        object.source = { file, line: reference.start.line };
    }
    objects.push(object);
  }
  const exportedNames = designNetlistNetNames(
    project,
    cell.id,
    [...nets].filter((id) => !netName(id)),
    netlistOptions,
  );
  for (const net of cell.nets) {
    if (nets.has(net.id))
      objects.push({
        kind: "net",
        id: net.id,
        label: netName(net.id) ?? exportedNames.get(net.id) ?? "(unnamed)",
      });
  }
  return {
    projectId: project.id,
    structureRevision: project.structureRevision,
    cellId: cell.id,
    cellName: cell.name,
    cellRevision: cell.revision,
    hierarchyPath: hierarchyPath.map((frame) => ({ ...frame })),
    sourceVersion,
    objects,
  };
}

export function reviewFeedbackLabel(target: ReviewFeedbackTarget): string {
  const names = target.objects.map(({ kind, label }) =>
    kind === "net" ? `Net ${label}` : label,
  );
  return `${target.cellName} · ${names.join(", ") || "Cell"}`;
}

/** One plain-text handoff, with each comment attached to its own captured targets. */
export async function reviewFeedbackText(
  notes: readonly ReviewNote[],
): Promise<string> {
  const sections = await Promise.all(
    notes.map(async ({ target, comment }, index) => {
      const lines = [
        ...(notes.length > 1 ? [`Note ${index + 1}`] : []),
        `Source version: ${target.sourceVersion}`,
        `Project: ${target.projectId} (structure revision ${target.structureRevision})`,
        `Cell: ${target.cellName} (${target.cellId})`,
        `Cell revision: ${target.cellRevision}`,
        ...(target.hierarchyPath.length
          ? [`Hierarchy: ${JSON.stringify(target.hierarchyPath)}`]
          : []),
      ];
      for (const object of target.objects) {
        lines.push(`Object: ${object.label} (${object.kind} ${object.id})`);
        if (!object.source) continue;
        const { file, line } = object.source;
        if (!file.originalContent) {
          lines.push(`Source: ${file.path}:${line}`);
          continue;
        }
        // Converted Spectre references point back to the file as delivered.
        const { originalSourceLine } =
          await import("../netlist-export/convert-import-sources");
        const originalLine = originalSourceLine(file, line);
        if (originalLine) lines.push(`Source: ${file.path}:${originalLine}`);
      }
      return [...lines, "", comment.trim()].join("\n");
    }),
  );
  return ["Canvas review feedback", ...sections].join("\n\n");
}
