import type {
  AgentNetlistRead,
  AgentProjectResourceRequest,
} from "@icm/agent-adapter";
import type { CircuitProject } from "@icm/model";
import { createRnlExport, type RnlExport } from "@icm/rnl";
import type { RnlRuntime, RnlWritten } from "./rnl-runtime";

type ReadNetlistRequest = Extract<
  AgentProjectResourceRequest,
  { operation: "read-netlist" }
>;
type ReadRnlOptions = Pick<
  ReadNetlistRequest,
  "format" | "namingProfile" | "portCase" | "rootDocumentId"
>;
type RnlWriter = Pick<RnlRuntime, "write">;

export type RnlReader = (
  project: CircuitProject,
  options: ReadRnlOptions,
) => Promise<AgentNetlistRead>;

export function writeRnlNetlist(
  exported: Extract<RnlExport, { status: "ready" }>,
  runtime: RnlWriter,
): Promise<RnlWritten> {
  return runtime.write({
    write: exported.request,
    svg: false,
    primitives: false,
  });
}

/** Read the same interchange file the Netlist panel writes. */
export async function readRnl(
  project: CircuitProject,
  { format = "spice", namingProfile, portCase, rootDocumentId }: ReadRnlOptions,
  loadRuntime: () => Promise<RnlWriter | null>,
): Promise<AgentNetlistRead> {
  const exported = createRnlExport(project, {
    format,
    ...(namingProfile ? { namingProfile } : {}),
    ...(portCase ? { portCase } : {}),
    ...(rootDocumentId ? { rootDocumentId, uncalledCells: false } : {}),
  });
  const diagnostics = [
    ...exported.netlistDiagnostics,
    ...exported.diagnostics,
  ].map(({ severity, code, message, objectIds }) => ({
    severity,
    code,
    message,
    objectIds: [...objectIds],
  }));
  const response = {
    documentId: rootDocumentId ?? project.topDocumentId,
    format,
    rnl: true,
    diagnostics,
  };
  if (exported.status === "blocked")
    return { ...response, status: "blocked", text: null };

  const failed = (code: string, message: string): AgentNetlistRead => ({
    ...response,
    status: "blocked",
    text: null,
    diagnostics: [
      ...diagnostics,
      { severity: "error", code, message, objectIds: [] },
    ],
  });
  try {
    const runtime = await loadRuntime();
    if (!runtime)
      return failed(
        "RNL_RUNTIME_UNAVAILABLE",
        "The RNL runtime is not available.",
      );
    const written = await writeRnlNetlist(exported, runtime);
    return {
      ...response,
      status: "ready",
      text: written.text,
      diagnostics: [
        ...diagnostics,
        ...written.document.diagnostics.map<
          AgentNetlistRead["diagnostics"][number]
        >(({ severity, message }) => ({
          severity:
            severity === "error" || severity === "warning" ? severity : "info",
          code: "RNL_RUNTIME",
          message,
          objectIds: [],
        })),
      ],
    };
  } catch (error) {
    return failed(
      "RNL_WRITE_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
}
