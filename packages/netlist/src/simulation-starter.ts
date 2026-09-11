import { createSourceSimulationSetup, type CircuitProject } from "@icm/model";
import { analyzeDesignNetlist } from "./extract.js";

/** Resolve the interface through the same printer IR as the generated DUT. */
export function createSimulationStarter(
  project: CircuitProject,
  options: {
    id: string;
    name: string;
    profileId: string;
    documentId?: string;
    mode: "circuit" | "dut" | "text";
  },
) {
  if (options.mode === "text")
    return {
      ok: true as const,
      setup: createSourceSimulationSetup({
        id: options.id,
        name: options.name,
        profileId: options.profileId,
      }),
    };
  if (!options.documentId)
    return {
      ok: false as const,
      message: "Select a Cell for this experiment.",
    };
  if (options.mode === "circuit")
    return { ok: true as const, setup: createSourceSimulationSetup(options) };
  const analysis = analyzeDesignNetlist(project, {
    format: "spice",
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
    setup: createSourceSimulationSetup({
      ...options,
      dut: { name: root.name, ports: root.ports.map((port) => port.netName) },
    }),
  };
}
