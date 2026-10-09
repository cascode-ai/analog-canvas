import { agentToolHelp } from "./guidance.generated.js";
import { z } from "zod";
import {
  createSimulationStarter,
  newFolderCellRole,
  newFolderProfile,
} from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import { AGENT_API_VERSION } from "@icm/agent-adapter";
import { lazyContract } from "./input-contract.js";
import {
  createSimulationFolder,
  readSimulationExperimentConfig,
  replaceSimulationExperimentConfig,
  SimulationSourceInputSchema,
  SimulationSourceExpressionSchema,
  SimulationMeasurementSpecSchema,
  SimulationSourceDeviceOperatingPointSchema,
  type CircuitProject,
  type ProjectSimulationFolder,
  type SimulationExperimentConfig,
} from "@icm/model";
import type { ContractTool } from "./tool-contracts.js";
import type { OperationSession as ToolSessionState } from "./operation-session.js";
import type { CachedSnapshot } from "@icm/agent-client";

const Id = z.string().min(1).max(256);
const Name = z.string().trim().min(1).max(128);
const SpiceIdentifier = Id.regex(
  /^[A-Za-z_][A-Za-z0-9_]*$/u,
  "Use an ASCII SPICE identifier (letters, digits and underscores)",
);
const common = {
  documentId: Id.optional(),
  refresh: z.boolean().optional(),
};
const FolderArgs = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("list"),
    ...common,
    rootDocumentId: Id.optional(),
  }),
  z.strictObject({ action: z.literal("get"), ...common, folderId: Id }),
  z.strictObject({
    action: z.literal("create"),
    ...common,
    folderId: Id.optional(),
    name: Name,
    rootDocumentId: Id.optional(),
    profileId: Id.optional().describe(
      "Omit to take the one Profile whose listed qualified devices include every reviewed PDK device the root Cell uses; a Profile listing none (VACASK) is never the default. Otherwise create refuses with error.candidates.",
    ),
    template: z.enum(["op", "ac", "tran"]).optional(),
    dut: z
      .strictObject({
        name: SpiceIdentifier.optional().describe(
          "Optional exact exported subcircuit name; when rootDocumentId is present it is derived and checked against the Cell.",
        ),
        ports: z
          .array(SpiceIdentifier)
          .optional()
          .describe(
            "Optional testbench node names in the exported subcircuit's exact order; the count must match the Cell interface, and a name that is one of the Cell's ports must be at that port's position. Names must be ASCII SPICE identifiers.",
          ),
      })
      .optional(),
  }),
  z.strictObject({
    action: z.literal("update"),
    ...common,
    folderId: Id,
    name: Name.optional(),
    input: SimulationSourceInputSchema.optional(),
  }),
  z.strictObject({
    action: z.literal("clone"),
    ...common,
    folderId: Id,
    newFolderId: Id.optional(),
    name: Name,
  }),
  z.strictObject({ action: z.literal("remove"), ...common, folderId: Id }),
]);
const OutputArgs = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list"), ...common, folderId: Id }),
  z.strictObject({
    action: z.literal("upsert"),
    ...common,
    folderId: Id,
    outputId: Id.optional(),
    label: Name,
    expression: SimulationSourceExpressionSchema,
  }),
  z.strictObject({
    action: z.literal("remove"),
    ...common,
    folderId: Id,
    outputId: Id,
  }),
]);
const MeasurementArgs = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list"), ...common, folderId: Id }),
  SimulationMeasurementSpecSchema.omit({ id: true }).extend({
    action: z.literal("upsert"),
    ...common,
    folderId: Id,
    measurementId: Id.optional(),
  }),
  z.strictObject({
    action: z.literal("remove"),
    ...common,
    folderId: Id,
    measurementId: Id,
  }),
]);
const DeviceArgs = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list"), ...common, folderId: Id }),
  z.strictObject({
    action: z.literal("upsert"),
    ...common,
    folderId: Id,
    deviceOperatingPointId: Id.optional(),
    targetDocumentId: Id,
    instanceId: Id,
    occurrence:
      SimulationSourceDeviceOperatingPointSchema.shape.occurrence.default([]),
    circuit: SimulationSourceDeviceOperatingPointSchema.shape.circuit,
  }),
  z.strictObject({
    action: z.literal("remove"),
    ...common,
    folderId: Id,
    deviceOperatingPointId: Id,
  }),
]);
interface Entry {
  definition: ContractTool;
  handle(args: unknown, session: ToolSessionState): Promise<unknown>;
}
const failure = (code: string, message: string) => ({
  ok: false,
  error: { code, message, recovery: "fix-input" },
});
const ENGINE_REQUIRED =
  "The selected Profile must advertise its engine before creating a template. Existing source remains editable.";
function tool<T extends z.ZodType>(
  name: string,
  description: string,
  schema: T,
  handle: (args: z.infer<T>, session: ToolSessionState) => Promise<unknown>,
): Entry {
  return {
    definition: {
      name,
      description,
      get inputSchema() {
        return lazyContract(schema, true);
      },
    },
    handle: async (args, session) => {
      // The request envelope the other simulation tools take is accepted
      // here too, flattened (#1231).
      const parsed = schema.safeParse(flattenedRequest(args));
      if (!parsed.success)
        return failure(
          "SIMULATION_HELPER_INPUT_INVALID",
          `${parsed.error.issues[0]!.path.join(".") || "input"}: ${parsed.error.issues[0]!.message}`,
        );
      try {
        return await handle(parsed.data, session);
      } catch (error) {
        if (error instanceof z.ZodError)
          return failure(
            "SIMULATION_CONFIG_INVALID",
            error.issues[0]?.message ?? "Invalid configuration",
          );
        throw error;
      }
    },
  };
}
async function read(
  session: ToolSessionState,
  folderId: string,
  documentId?: string,
  refresh = false,
) {
  const snapshot = await session.client.snapshot(documentId, { refresh });
  const folder = snapshot.snapshot.project.simulationFolders.find(
    (item) => item.id === folderId,
  );
  if (!folder)
    return {
      ok: false as const,
      result: failure(
        "SIMULATION_FOLDER_NOT_FOUND",
        `Experiment ${folderId} does not exist`,
      ),
    };
  const parsed = readSimulationExperimentConfig(folder);
  if (!parsed.ok)
    return {
      ok: false as const,
      result: failure(
        "SIMULATION_CONFIG_INVALID",
        `${parsed.path}: ${parsed.message}. Source files remain editable through simulation_files.`,
      ),
    };
  if (parsed.authority === "code")
    return {
      ok: false as const,
      result: failure(
        "SIMULATION_NATIVE_CODE_REQUIRED",
        "This experiment is native VACASK Code-authoritative. Use simulation_files for native save v/dv/i/di/p selectors and analysis commands; derived quantities use authored postprocess Python. Read simulation authoring-help for shared source helpers. Legacy JSON helpers cannot downgrade it or add another electrical authority.",
      ),
    };
  return {
    ok: true as const,
    folder,
    config: parsed.config,
    revision: snapshot.snapshot.project.structureRevision,
    snapshot,
  };
}
async function save(
  session: ToolSessionState,
  folder: ProjectSimulationFolder,
  revision: number,
  documentId?: string,
  snapshot?: CachedSnapshot,
) {
  return projectReceipt(
    await session.client.advancedTransact(
      { structureEdits: [{ kind: "upsert_simulation_folder", folder }] },
      {
        ...(documentId ? { documentId } : {}),
        expectedStructureRevision: revision,
        ...(snapshot ? { snapshot } : {}),
      },
    ),
  );
}

/**
 * A Project-level change's receipt, without the open drawing's visual and
 * netlist diagnostics: they say nothing about a simulation folder and made
 * a folder's receipt mostly about the drawing (#1231). A refusal keeps its
 * own diagnostics, which are about the change.
 */
function projectReceipt<T extends { ok: boolean }>(report: T): T {
  if (!report.ok) return report;
  const {
    diagnostics: _diagnostics,
    diagnosticDelta: _delta,
    ...receipt
  } = report as T & { diagnostics?: unknown; diagnosticDelta?: unknown };
  return receipt as T;
}

function configFolder(
  folder: ProjectSimulationFolder,
  config: SimulationExperimentConfig,
) {
  return replaceSimulationExperimentConfig(folder, config);
}
function upsert<T extends { id: string }>(items: T[], item: T) {
  const at = items.findIndex((current) => current.id === item.id);
  if (at < 0) items.push(item);
  else items[at] = item;
}

export const simulationAuthoringTools: readonly Entry[] = [
  tool(
    "simulation_folder",
    agentToolHelp["simulation_folder"],
    FolderArgs,
    async (parsed, session) => {
      if (parsed.action === "list") {
        const directory = await session.client.simulationFolderDirectory(
          parsed.documentId,
          { refresh: parsed.refresh ?? false },
        );
        return {
          ok: true,
          folders: directory.folders.filter(
            (folder) =>
              !parsed.rootDocumentId ||
              folder.circuitBindings.some(
                (binding) => binding.documentId === parsed.rootDocumentId,
              ),
          ),
        };
      }
      const snapshot = await session.client.snapshot(parsed.documentId, {
        refresh: parsed.refresh ?? false,
      });
      const project = snapshot.snapshot.project;
      const current = project.simulationFolders.find(
        (folder) => folder.id === parsed.folderId,
      );
      if (parsed.action === "get")
        return current
          ? { ok: true, folder: current }
          : failure("SIMULATION_FOLDER_NOT_FOUND", "Experiment does not exist");
      if (parsed.action !== "create" && !current)
        return failure(
          "SIMULATION_FOLDER_NOT_FOUND",
          "Experiment does not exist",
        );
      if (parsed.action === "remove")
        return projectReceipt(
          await session.client.advancedTransact(
            {
              structureEdits: [
                { kind: "remove_simulation_folder", folderId: parsed.folderId },
              ],
            },
            {
              ...(parsed.documentId ? { documentId: parsed.documentId } : {}),
              expectedStructureRevision: project.structureRevision,
              snapshot,
            },
          ),
        );
      let next: ProjectSimulationFolder;
      let dut: { name: string; ports: string[]; subckt: string } | undefined;
      let chosen:
        { profileId: string; engine: "ngspice" | "vacask" } | undefined;
      if (parsed.action === "create") {
        if (parsed.dut && !parsed.rootDocumentId)
          return failure(
            "SIMULATION_DUT_CELL_REQUIRED",
            "A DUT template needs rootDocumentId; omit dut for text-only input.",
          );
        // Without a profileId the default reads each Profile's qualified
        // devices, which only the full discovery lists (#1349).
        const discovery = await session.client.simulationMetadataResource(
          {
            apiVersion: "3.0",
            requestId: crypto.randomUUID(),
            operation: "capabilities",
            detail: parsed.profileId ? "summary" : "full",
          },
          { refresh: parsed.refresh },
        );
        if (!discovery.ok) return discovery;
        if (!("capabilities" in discovery))
          return failure(
            "SIMULATION_PROFILE_UNAVAILABLE",
            "Expected simulation Profile discovery",
          );
        const profiles = discovery.capabilities.profiles;
        // A named Profile is checked before the Project is read.
        let profile = parsed.profileId
          ? profiles.find((item) => item.id === parsed.profileId)
          : undefined;
        if (parsed.profileId && !profile?.engine)
          return failure("SIMULATION_PROFILE_UNAVAILABLE", ENGINE_REQUIRED);
        // The whole Project, for the DUT's interface and the devices the
        // default Profile must qualify.
        let cell: { project: CircuitProject; documentId: string } | undefined;
        if (parsed.rootDocumentId) {
          const code = await session.client.projectResource({
            apiVersion: AGENT_API_VERSION,
            requestId: crypto.randomUUID(),
            operation: "read-project-code",
          });
          if (!code.ok || code.operation !== "read-project-code")
            return failure(
              "SIMULATION_DUT_INTERFACE_UNAVAILABLE",
              code.ok ? "Expected Project Code" : code.error.message,
            );
          if (code.structureRevision !== project.structureRevision)
            return failure(
              "SIMULATION_DUT_STALE",
              "Project changed while resolving the DUT; refresh and create again",
            );
          cell = {
            project: parseProject(code.projectCode),
            documentId: parsed.rootDocumentId,
          };
        }
        if (!profile) {
          if (!profiles.length)
            return failure(
              "SIMULATION_PROFILE_UNAVAILABLE",
              "No simulation Profile is advertised.",
            );
          const choice = newFolderProfile(profiles, cell);
          if (!choice.ok)
            return {
              ok: false,
              error: {
                code: "SIMULATION_PROFILE_REQUIRED",
                message: `${choice.message} Name one in profileId: ${choice.candidates.join(", ")}.`,
                recovery: "fix-input",
                candidates: choice.candidates,
              },
            };
          profile = profiles.find((item) => item.id === choice.profileId);
        }
        if (!profile?.engine)
          return failure("SIMULATION_PROFILE_UNAVAILABLE", ENGINE_REQUIRED);
        chosen = { profileId: profile.id, engine: profile.engine };
        const profileId = profile.id;
        // A Cell with pins is the DUT of a testbench.spice shell; one without
        // is the testbench, run as the deck's top (#1489). dut wraps either.
        if (
          cell &&
          (parsed.dut ||
            newFolderCellRole(cell.project, cell.documentId) === "dut")
        ) {
          const starter = createSimulationStarter(cell.project, {
            id: parsed.folderId ?? crypto.randomUUID(),
            name: parsed.name,
            profileId,
            engine: profile.engine,
            documentId: cell.documentId,
            mode: "dut",
            ...(parsed.template ? { template: parsed.template } : {}),
          });
          if (!starter.ok || !starter.dut)
            return failure(
              "SIMULATION_DUT_INTERFACE_BLOCKED",
              starter.ok ? "Expected a DUT interface" : starter.message,
            );
          const resolved = starter.dut;
          if (parsed.dut?.name && parsed.dut.name !== resolved.name)
            return failure(
              "SIMULATION_DUT_NAME_MISMATCH",
              `dut.name must match the exported Cell name ${resolved.name}`,
            );
          if (
            parsed.dut?.ports &&
            parsed.dut.ports.length !== resolved.ports.length
          )
            return failure(
              "SIMULATION_DUT_PORT_COUNT_MISMATCH",
              `dut.ports must contain ${resolved.ports.length} names in the exported order`,
            );
          // The testbench connects dut.ports to the Cell by position. A name
          // that is one of the Cell's ports must therefore sit where that
          // port is; any other name is just the testbench node's name.
          const misplaced = (parsed.dut?.ports ?? []).flatMap((name, index) => {
            const at = resolved.ports.findIndex(
              (port) => port.toLowerCase() === name.toLowerCase(),
            );
            return at >= 0 && at !== index
              ? [`${name} is at position ${index + 1}, the Cell's ${at + 1}`]
              : [];
          });
          if (misplaced.length)
            return failure(
              "SIMULATION_DUT_PORT_ORDER_MISMATCH",
              `dut.ports must follow the exported order ${resolved.ports.join(" ")}: ${misplaced.join("; ")}`,
            );
          dut = {
            ...resolved,
            subckt:
              `.subckt ${resolved.name} ${resolved.ports.join(" ")}`.trimEnd(),
            ...(parsed.dut?.ports ? { ports: parsed.dut.ports } : {}),
          };
        }
        next = createSimulationFolder({
          id: parsed.folderId ?? crypto.randomUUID(),
          name: parsed.name,
          profileId,
          engine: profile.engine,
          ...(dut ? { dut } : {}),
          ...(parsed.template ? { template: parsed.template } : {}),
          ...(parsed.rootDocumentId
            ? { documentId: parsed.rootDocumentId }
            : {}),
        });
      } else if (parsed.action === "clone")
        next = {
          ...structuredClone(current!),
          id: parsed.newFolderId ?? crypto.randomUUID(),
          name: parsed.name,
        };
      else {
        if (parsed.name === undefined && parsed.input === undefined)
          return failure(
            "SIMULATION_FOLDER_UPDATE_EMPTY",
            "Supply a name or source input; use simulation_files for text patches",
          );
        next = {
          ...current!,
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.input ? { input: parsed.input } : {}),
        };
      }
      const result = await save(
        session,
        next,
        project.structureRevision,
        parsed.documentId,
        snapshot,
      );
      return result.ok
        ? {
            folder: {
              id: next.id,
              name: next.name,
              entry: next.input.entry,
              // A new folder names the Profile and engine its code is for.
              ...chosen,
            },
            ...(dut
              ? {
                  dut: {
                    name: dut.name,
                    ports: dut.ports,
                    subckt: dut.subckt,
                  },
                }
              : {}),
            source: {
              owner: { kind: "project-folder", folderId: next.id },
              ...(result.projectStructure
                ? { revision: result.projectStructure.toRevision }
                : !result.applied
                  ? { revision: project.structureRevision }
                  : {}),
              entry: next.input.entry,
              configPath: next.input.configPath,
              files: [
                ...next.input.files.map((file) => ({
                  path: file.path,
                  kind: "authored",
                  editing: "text",
                })),
                ...next.input.circuitBindings.map((binding) => ({
                  path: binding.path,
                  kind: "generated",
                  editing: "mapped-parameters",
                })),
                ...next.input.dependencies.map((dependency) => ({
                  path: dependency.mountPath,
                  kind: "dependency",
                  editing: "read-only",
                })),
              ],
            },
            ...result,
          }
        : result;
    },
  ),
  tool(
    "simulation_output",
    agentToolHelp["simulation_output"],
    OutputArgs,
    async (parsed, session) => {
      const result = await read(
        session,
        parsed.folderId,
        parsed.documentId,
        parsed.refresh,
      );
      if (!result.ok) return result.result;
      const { config } = result;
      if (parsed.action === "list")
        return { ok: true, outputs: config.outputs };
      if (parsed.action === "remove") {
        if (!config.outputs.some((o) => o.id === parsed.outputId))
          return failure(
            "SIMULATION_OUTPUT_NOT_FOUND",
            "Output does not exist",
          );
        config.outputs = config.outputs.filter((o) => o.id !== parsed.outputId);
        config.measurements = config.measurements.filter(
          (m) => m.outputId !== parsed.outputId,
        );
      } else
        upsert(config.outputs, {
          id: parsed.outputId ?? crypto.randomUUID(),
          label: parsed.label,
          expression: parsed.expression,
        });
      return save(
        session,
        configFolder(result.folder, config),
        result.revision,
        parsed.documentId,
        result.snapshot,
      );
    },
  ),
  tool(
    "simulation_measurement",
    agentToolHelp["simulation_measurement"],
    MeasurementArgs,
    async (parsed, session) => {
      const result = await read(
        session,
        parsed.folderId,
        parsed.documentId,
        parsed.refresh,
      );
      if (!result.ok) return result.result;
      const { config } = result;
      if (parsed.action === "list")
        return { ok: true, measurements: config.measurements };
      if (parsed.action === "remove") {
        if (!config.measurements.some((m) => m.id === parsed.measurementId))
          return failure(
            "SIMULATION_MEASUREMENT_NOT_FOUND",
            "Measurement does not exist",
          );
        config.measurements = config.measurements.filter(
          (m) => m.id !== parsed.measurementId,
        );
      } else
        upsert(config.measurements, {
          id: parsed.measurementId ?? crypto.randomUUID(),
          label: parsed.label,
          analysis: parsed.analysis,
          outputId: parsed.outputId,
          method: parsed.method,
        });
      return save(
        session,
        configFolder(result.folder, config),
        result.revision,
        parsed.documentId,
        result.snapshot,
      );
    },
  ),
  tool(
    "simulation_device_operating_point",
    agentToolHelp["simulation_device_operating_point"],
    DeviceArgs,
    async (parsed, session) => {
      const result = await read(
        session,
        parsed.folderId,
        parsed.documentId,
        parsed.refresh,
      );
      if (!result.ok) return result.result;
      const { config } = result;
      if (parsed.action === "list")
        return {
          ok: true,
          deviceOperatingPoints: config.deviceOperatingPoints,
        };
      if (parsed.action === "remove") {
        if (
          !config.deviceOperatingPoints.some(
            (m) => m.id === parsed.deviceOperatingPointId,
          )
        )
          return failure(
            "SIMULATION_DEVICE_OPERATING_POINT_NOT_FOUND",
            "Selection does not exist",
          );
        config.deviceOperatingPoints = config.deviceOperatingPoints.filter(
          (m) => m.id !== parsed.deviceOperatingPointId,
        );
      } else
        upsert(config.deviceOperatingPoints, {
          id: parsed.deviceOperatingPointId ?? crypto.randomUUID(),
          documentId: parsed.targetDocumentId,
          instanceId: parsed.instanceId,
          occurrence: parsed.occurrence,
          circuit: parsed.circuit,
        });
      return save(
        session,
        configFolder(result.folder, config),
        result.revision,
        parsed.documentId,
        result.snapshot,
      );
    },
  ),
];

/** Arguments sent as {request: {...}} the way a request tool takes them. */
function flattenedRequest(args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const { request, ...rest } = args as { request?: unknown };
  return request && typeof request === "object" && !Array.isArray(request)
    ? { ...rest, ...(request as object) }
    : args;
}
