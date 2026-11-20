import type { AgentNetlistRead } from "@icm/agent-adapter";
import type { CircuitProject } from "@icm/model";
import { createRnlExport, type RnlExport } from "@icm/rnl";

import { loadRnlRuntime, type RnlWritten } from "./rnl-runtime";

export interface ReadRnlOptions {
  format?: "spice" | "spectre" | undefined;
  namingProfile?: "native" | "cadence-bang" | undefined;
  rootDocumentId?: string | undefined;
}

type Diagnostic = AgentNetlistRead["diagnostics"][number];

function diagnostic(
  severity: "error" | "warning" | "info",
  code: string,
  message: string,
): Diagnostic {
  return { severity, code, message, objectIds: [] };
}

function exportDiagnostics(
  exported: Extract<RnlExport, { status: "ready" }>,
  written: RnlWritten | null,
): Diagnostic[] {
  return [
    ...exported.diagnostics.map((item) =>
      diagnostic(item.severity, item.code, item.message),
    ),
    ...(written?.document.diagnostics ?? []).map((item) =>
      diagnostic(
        item.severity === "error" || item.severity === "warning"
          ? item.severity
          : "info",
        "RNL_RUNTIME",
        item.message,
      ),
    ),
  ];
}

/** The answer a blocked RNL export gives, with the netlist's own findings. */
export function blockedRnl(
  format: "spice" | "spectre",
  exported: Extract<RnlExport, { status: "blocked" }>,
): AgentNetlistRead {
  return {
    format,
    rnl: true,
    status: "blocked",
    text: null,
    diagnostics: [
      ...exported.diagnostics.map((item) =>
        diagnostic(item.severity, item.code, item.message),
      ),
      ...exported.netlistDiagnostics
        .filter((item) => item.severity === "error")
        .map((item) => diagnostic("error", item.code, item.message)),
    ],
  };
}

/** The answer a written RNL export gives, with the runtime's findings. */
export function writtenRnl(
  format: "spice" | "spectre",
  exported: Extract<RnlExport, { status: "ready" }>,
  written: RnlWritten,
): AgentNetlistRead {
  return {
    format,
    rnl: true,
    status: "ready",
    text: written.text,
    diagnostics: exportDiagnostics(exported, written),
  };
}

/** A failure of the runtime itself, not of the circuit. */
export function failedRnl(
  format: "spice" | "spectre",
  code: string,
  message: string,
): AgentNetlistRead {
  return {
    format,
    rnl: true,
    status: "blocked",
    text: null,
    diagnostics: [diagnostic("error", code, message)],
  };
}

/**
 * The Project's netlist with its drawing written as RNL, exactly as the
 * Netlist panel's SPICE+RNL and Spectre+RNL views write it. A page supplies
 * the runtime Worker here; a headless workspace supplies the same core.
 */
export async function readRnlBrowser(
  project: CircuitProject,
  options: ReadRnlOptions,
): Promise<AgentNetlistRead> {
  const format = options.format ?? "spice";
  const documentId = options.rootDocumentId ?? project.topDocumentId;
  const exported = createRnlExport(project, {
    format,
    ...(options.namingProfile ? { namingProfile: options.namingProfile } : {}),
    ...(options.rootDocumentId
      ? { rootDocumentId: options.rootDocumentId }
      : {}),
  });
  if (exported.status !== "ready")
    return { ...blockedRnl(format, exported), documentId };

  try {
    const runtime = await loadRnlRuntime();
    if (!runtime)
      return {
        ...failedRnl(
          format,
          "RNL_RUNTIME_UNAVAILABLE",
          "The RNL runtime is not available; nothing was written.",
        ),
        documentId,
      };
    const written = await runtime.write({
      write: exported.request,
      svg: false,
      primitives: false,
    });
    return { ...writtenRnl(format, exported, written), documentId };
  } catch (error) {
    return {
      ...failedRnl(
        format,
        "RNL_WRITE_FAILED",
        error instanceof Error ? error.message : String(error),
      ),
      documentId,
    };
  }
}
