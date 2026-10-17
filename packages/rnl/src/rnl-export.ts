import type { CircuitProject } from "@icm/model";
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
 */
export function createRnlExport(
  project: CircuitProject,
  options: Pick<
    DesignNetlistAnalysisOptions,
    "namingProfile" | "rootDocumentId"
  > & { format: NetlistFormat },
): RnlExport {
  const result = createDesignNetlistExport(project, {
    ...options,
    bodyPortOrder: rnlBodyPortOrder(project),
    includeIr: true,
  });
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
