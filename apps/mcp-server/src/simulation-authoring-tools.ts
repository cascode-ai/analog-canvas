import { agentToolHelp } from "./guidance.generated.js";
import { z } from "zod";
import {
  createSimulationFolder,
  readSimulationExperimentConfig,
  replaceSimulationExperimentConfig,
  SimulationSourceInputSchema,
  SimulationSourceExpressionSchema,
  SimulationMeasurementSpecSchema,
  SimulationSourceDeviceOperatingPointSchema,
  type ProjectSimulationFolder,
  type SimulationExperimentConfig,
} from "@icm/model";
import type { McpToolDefinition } from "./protocol.js";
import type { ToolSessionState } from "./tools.js";
import type { CachedSnapshot } from "@icm/agent-client";

const Id = z.string().min(1).max(256);
const Name = z.string().trim().min(1).max(128);
const NativeName = Id.regex(
  /^\S+$/u,
  "Use an exact native identifier without whitespace",
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
    profileId: Id,
    template: z.enum(["op", "ac", "tran"]).optional(),
    dut: z
      .strictObject({
        name: NativeName.describe(
          "Exact exported subcircuit name, not the instance name XDUT. For .subckt dut IN OUT, use name:'dut'; the template creates XDUT IN OUT dut.",
        ),
        ports: z
          .array(NativeName)
          .describe(
            "Port names in the exported subcircuit's exact order; the template uses these as testbench node names. Do not reorder power pins. Read the generated circuit interface when unknown.",
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
  definition: McpToolDefinition;
  handle(args: unknown, session: ToolSessionState): Promise<unknown>;
}
const failure = (code: string, message: string) => ({
  ok: false,
  error: { code, message, recovery: "fix-input" },
});
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
      inputSchema: {
        ...z.toJSONSchema(schema, { target: "draft-2020-12", reused: "ref" }),
        type: "object",
      },
    },
    handle: async (args, session) => {
      const parsed = schema.safeParse(args);
      if (!parsed.success)
        return failure(
          "SIMULATION_HELPER_INPUT_INVALID",
          parsed.error.issues[0]!.message,
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
  return session.client.advancedTransact(
    { structureEdits: [{ kind: "upsert_simulation_folder", folder }] },
    {
      ...(documentId ? { documentId } : {}),
      expectedStructureRevision: revision,
      ...(snapshot ? { snapshot } : {}),
    },
  );
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
      const snapshot = await session.client.snapshot(parsed.documentId, {
        refresh: parsed.refresh ?? false,
      });
      const project = snapshot.snapshot.project;
      if (parsed.action === "list")
        return {
          ok: true,
          folders: project.simulationFolders
            .filter(
              (folder) =>
                !parsed.rootDocumentId ||
                folder.input.circuitBindings.some(
                  (b) => b.documentId === parsed.rootDocumentId,
                ),
            )
            .map((folder) => ({
              id: folder.id,
              name: folder.name,
              entry: folder.input.entry,
              circuitBindings: folder.input.circuitBindings,
            })),
        };
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
        return session.client.advancedTransact(
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
        );
      let next: ProjectSimulationFolder;
      if (parsed.action === "create") {
        if (parsed.dut && !parsed.rootDocumentId)
          return failure(
            "SIMULATION_DUT_CELL_REQUIRED",
            "A DUT template needs rootDocumentId; omit dut for text-only input.",
          );
        const discovery = await session.client.simulationResource({
          apiVersion: "3.0",
          requestId: crypto.randomUUID(),
          operation: "capabilities",
        });
        if (!discovery.ok) return discovery;
        if (!("capabilities" in discovery))
          return failure(
            "SIMULATION_PROFILE_UNAVAILABLE",
            "Expected simulation Profile discovery",
          );
        const profile = discovery.capabilities.profiles.find(
          (item) => item.id === parsed.profileId,
        );
        if (!profile?.engine)
          return failure(
            "SIMULATION_PROFILE_UNAVAILABLE",
            "The selected Profile must advertise its engine before creating a template. Existing source remains editable.",
          );
        next = createSimulationFolder({
          id: parsed.folderId ?? crypto.randomUUID(),
          name: parsed.name,
          profileId: parsed.profileId,
          engine: profile.engine,
          ...(parsed.dut ? { dut: parsed.dut } : {}),
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
            ...result,
            folder: { id: next.id, name: next.name, entry: next.input.entry },
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
