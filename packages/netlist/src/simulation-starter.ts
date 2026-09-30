import { createSimulationFolder, type CircuitProject } from "@icm/model";
import { analyzeDesignNetlist } from "./extract.js";

export interface SimulationStarterDut {
  name: string;
  ports: string[];
}

export type SimulationStarterResult =
  | {
      ok: true;
      folder: ReturnType<typeof createSimulationFolder>;
      dut?: SimulationStarterDut;
    }
  | { ok: false; message: string };

/** Resolve the interface through the same printer IR as the generated DUT. */
export function createSimulationStarter(
  project: CircuitProject,
  options: {
    id: string;
    name: string;
    profileId: string;
    engine?: "ngspice" | "vacask";
    documentId?: string;
    mode: "circuit" | "dut" | "text";
    template?: "op" | "ac" | "tran";
  },
): SimulationStarterResult {
  if (options.mode === "text")
    return {
      ok: true as const,
      folder: createSimulationFolder({
        id: options.id,
        name: options.name,
        profileId: options.profileId,
        ...(options.engine ? { engine: options.engine } : {}),
        ...(options.template ? { template: options.template } : {}),
      }),
    };
  if (!options.documentId)
    return {
      ok: false as const,
      message: "Select a Cell for this experiment.",
    };
  if (options.mode === "circuit")
    return { ok: true as const, folder: createSimulationFolder(options) };
  const analysis = analyzeDesignNetlist(project, {
    format: "spice",
    groundPin: "pin",
    rootDocumentId: options.documentId,
  });
  const root = analysis.ir?.cells.find(
    (cell) => cell.id === analysis.ir!.topCellId,
  );
  if (!root)
    return {
      ok: false as const,
      message:
        analysis.diagnostics.map((d) => d.message).join("; ") ||
        "The DUT interface could not be resolved. You can still create a text-only experiment.",
    };
  return {
    ok: true as const,
    dut: { name: root.name, ports: root.ports.map((port) => port.netName) },
    folder: createSimulationFolder({
      ...options,
      dut: { name: root.name, ports: root.ports.map((port) => port.netName) },
    }),
  };
}
