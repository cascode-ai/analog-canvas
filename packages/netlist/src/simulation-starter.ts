import { reviewedExternalBindingForMaster } from "@icm/devices";
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

/** An advertised simulation Profile, as far as a new folder's default reads it. */
export interface AdvertisedSimulationProfile {
  readonly id: string;
  /** Exact model or wrapper names the Profile qualifies. */
  readonly devices?: readonly string[] | undefined;
}

export type NewFolderProfile =
  | { ok: true; profileId: string }
  | { ok: false; message: string; candidates: string[] };

/**
 * The Profile a new simulation folder starts from when the author names none
 * (#1349), for the Agent's `simulation_folder` and the GUI's new-experiment
 * dialog alike: the one Profile whose qualified devices include every
 * reviewed PDK device the folder's Cell and its sub-Cells use. A folder
 * without a Cell uses no PDK device. A Profile that lists no qualified
 * devices, as VACASK's, is never the default. With several such Profiles,
 * or none, the author names one of the candidates.
 */
export function newFolderProfile(
  profiles: readonly AdvertisedSimulationProfile[],
  cell?: { project: CircuitProject; documentId: string },
): NewFolderProfile {
  const used = cell ? cellPdkDevices(cell.project, cell.documentId) : [];
  const qualifies = (profile: AdvertisedSimulationProfile, name: string) =>
    !!profile.devices?.some(
      (device) => device.toLowerCase() === name.toLowerCase(),
    );
  const qualified = profiles.filter(
    (profile) =>
      !!profile.devices?.length &&
      used.every((name) => qualifies(profile, name)),
  );
  if (qualified.length === 1) return { ok: true, profileId: qualified[0]!.id };
  const unqualified = used.filter(
    (name) => !profiles.some((profile) => qualifies(profile, name)),
  );
  return {
    ok: false,
    candidates: (qualified.length ? qualified : profiles).map(
      (profile) => profile.id,
    ),
    message: !profiles.length
      ? "No simulation Profile is advertised."
      : qualified.length
        ? "Several Profiles qualify every PDK device this folder uses."
        : unqualified.length
          ? `No Profile qualifies ${unqualified.join(", ")}.`
          : used.length
            ? `No one Profile qualifies all of ${used.join(", ")}.`
            : "No Profile lists the devices it qualifies.",
  };
}

/**
 * The reviewed PDK devices a Cell and its sub-Cells are bound to: the names
 * a Profile's qualified devices list. No Profile qualifies ideal blocks, the
 * generic diode or authored models, so they do not count.
 */
function cellPdkDevices(
  project: CircuitProject,
  rootDocumentId: string,
): string[] {
  const names = new Map<string, string>();
  const seen = new Set<string>();
  const visit = (documentId: string) => {
    if (seen.has(documentId)) return;
    seen.add(documentId);
    const document = project.documents.find((item) => item.id === documentId);
    for (const instance of document?.instances ?? []) {
      const binding = instance.netlist?.binding;
      if (binding?.kind === "subcircuit") visit(binding.childDocumentId);
      const name =
        binding?.kind === "model" || binding?.kind === "unresolved-subcircuit"
          ? binding.name
          : binding?.kind === "external-subcircuit"
            ? project.externalSubcircuitDefinitions.find(
                (item) => item.id === binding.definitionId,
              )?.name
            : undefined;
      if (name && reviewedExternalBindingForMaster(name))
        names.set(name.toLowerCase(), name);
    }
  };
  visit(rootDocumentId);
  return [...names.values()].sort();
}
