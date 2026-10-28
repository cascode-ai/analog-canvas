import type { CircuitProject, StableId } from "@icm/model";
import {
  createDesignNetlistExport,
  type DesignNetlistAnalysisOptions,
  type NetlistDiagnostic,
  type NetlistFileDescriptor,
  type NetlistFormat,
} from "@icm/netlist";

import {
  rnlExportOps,
  type RnlExportDiagnostic,
  type RnlOp,
} from "./export-ops.js";
import { rnlBodyPortOrder } from "./symbol-map.js";

/**
 * What the rnl runtime's writer takes to write a drawing into its netlist:
 * the netlist as the SPICE+RNL or Spectre+RNL format prints it, and the edit
 * transaction's operations. The writer spells every RNL statement; this
 * editor never does.
 */
export interface RnlWriteRequest {
  dialect: NetlistFormat;
  /** The netlist text, bodies in their RNL symbols' port order. */
  netlist: string;
  ops: RnlOp[];
  /** Whose records these are (the rnl standard, chapter 17). */
  author: "analog-canvas";
}

export type RnlExport =
  | {
      status: "ready";
      request: RnlWriteRequest;
      /** The netlist file's kind: an RNL file is a netlist of the same dialect. */
      file: Pick<NetlistFileDescriptor, "mediaType" | "extension">;
      /** What the netlist printer found; the caller decides what blocks. */
      netlistDiagnostics: NetlistDiagnostic[];
      diagnostics: RnlExportDiagnostic[];
    }
  | {
      /** The netlist did not print, or RNL cannot draw part of it. */
      status: "blocked";
      netlistDiagnostics: NetlistDiagnostic[];
      diagnostics: RnlExportDiagnostic[];
    };

/**
 * The SPICE+RNL or Spectre+RNL export of a Project: its netlist, printed
 * with the RNL port order of the bodies the netlist writes itself, and the
 * operations that draw it as this editor does. An RNL error (a part turned by
 * 45°, a part with no RNL symbol) blocks it; warnings travel with the request.
 *
 * The netlist also prints the Cells the top does not call, so the file
 * carries every Cell's drawing; one the netlist cannot print stays out, and
 * the others are printed. A Cell the file does not carry is reported.
 */
export function createRnlExport(
  project: CircuitProject,
  options: Pick<
    DesignNetlistAnalysisOptions,
    "namingProfile" | "rootDocumentId"
  > & { format: NetlistFormat },
): RnlExport {
  const print = (uncalledCells: boolean, leaveOutCells: StableId[] = []) =>
    createDesignNetlistExport(project, {
      ...options,
      bodyPortOrder: rnlBodyPortOrder(project),
      includeIr: true,
      uncalledCells,
      leaveOutCells,
    });
  // An uncalled Cell the netlist cannot print, such as one not finished,
  // stays out with what only it calls; the others are printed.
  const reached = reachedCells(project, options.rootDocumentId);
  const leaveOut: StableId[] = [];
  let result = print(true);
  while (result.status !== "ready") {
    const blocking = [
      ...new Set(
        result.diagnostics.flatMap((item) =>
          item.severity === "error" &&
          item.documentId &&
          !reached.has(item.documentId) &&
          !leaveOut.includes(item.documentId)
            ? [item.documentId]
            : [],
        ),
      ),
    ];
    if (!blocking.length) {
      result = print(false);
      break;
    }
    leaveOut.push(...blocking);
    result = print(true, leaveOut);
  }
  if (result.status !== "ready")
    return {
      status: "blocked",
      netlistDiagnostics: result.diagnostics,
      diagnostics: [],
    };
  const { ops, diagnostics } = rnlExportOps(
    project,
    result.ir!,
    options.format,
  );
  const printed = new Set(result.ir!.cells.map((cell) => cell.id));
  const left = project.documents.filter(
    (document) => !printed.has(document.id),
  );
  if (left.length) {
    const names = left.map(
      (document) => document.netlist?.name ?? document.name,
    );
    diagnostics.push({
      severity: "warning",
      code: "RNL_CELL_NOT_WRITTEN",
      message: `${left.length} Cells are not in the file, with their drawings: ${names.join(", ")}. A Cell the netlist cannot print stays out, with every Cell the top does not call`,
      documentId: options.rootDocumentId ?? project.topDocumentId,
      objectIds: left.map((document) => document.id),
    });
  }
  if (diagnostics.some((item) => item.severity === "error"))
    return {
      status: "blocked",
      netlistDiagnostics: result.diagnostics,
      diagnostics,
    };
  return {
    status: "ready",
    file: {
      mediaType: result.file.mediaType,
      extension: result.file.extension,
    },
    request: {
      dialect: options.format,
      netlist: result.file.text,
      ops,
      author: "analog-canvas",
    },
    netlistDiagnostics: result.diagnostics,
    diagnostics,
  };
}

/** The Cells the top reaches through its calls, itself among them. */
function reachedCells(
  project: CircuitProject,
  rootDocumentId: StableId = project.topDocumentId,
): Set<StableId> {
  const reached = new Set<StableId>();
  const visit = (documentId: StableId) => {
    if (reached.has(documentId)) return;
    reached.add(documentId);
    for (const instance of project.documents.find(
      (document) => document.id === documentId,
    )?.instances ?? []) {
      const binding = instance.netlist?.binding;
      if (binding?.kind === "subcircuit") visit(binding.childDocumentId);
    }
  };
  visit(rootDocumentId);
  return reached;
}
