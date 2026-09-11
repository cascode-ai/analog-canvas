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

const Id = z.string().min(1).max(256);
const Name = z.string().trim().min(1).max(128);
const common = { documentId: Id.optional() };
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
) {
  const snapshot = await session.client.snapshot(documentId, { refresh: true });
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
  return {
    ok: true as const,
    folder,
    config: parsed.config,
    revision: snapshot.snapshot.project.structureRevision,
  };
}
async function save(
  session: ToolSessionState,
  folder: ProjectSimulationFolder,
  revision: number,
  documentId?: string,
) {
  return session.client.advancedTransact(
    { structureEdits: [{ kind: "upsert_simulation_folder", folder }] },
    {
      ...(documentId ? { documentId } : {}),
      expectedStructureRevision: revision,
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
    "Manage saved source experiments: list/get/create/clone/rename/remove. create writes the same small OP source template used by Code. Omit rootDocumentId for a text-only Testbench. Native analyses, .param, .temp and control programs are edited with simulation_files; input replacement can change bindings/dependencies. There is no parallel structured analyses authority. Updates are revision-guarded; malformed code can still be saved.",
    FolderArgs,
    async (parsed, session) => {
      const snapshot = await session.client.snapshot(parsed.documentId, {
        refresh: true,
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
          },
        );
      let next: ProjectSimulationFolder;
      if (parsed.action === "create")
        next = createSimulationFolder({
          id: parsed.folderId ?? crypto.randomUUID(),
          name: parsed.name,
          profileId: parsed.profileId,
          ...(parsed.template ? { template: parsed.template } : {}),
          ...(parsed.rootDocumentId
            ? { documentId: parsed.rootDocumentId }
            : {}),
        });
      else if (parsed.action === "clone")
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
      return save(session, next, project.structureRevision, parsed.documentId);
    },
  ),
  tool(
    "simulation_output",
    "Manage experiment output ASTs in the one configuration source file. Use {kind:'vector',vector:'v(out)'} for native vectors, circuit-qualified voltage/current for Canvas anchors, and unary/binary math ASTs. Native SPICE expressions in run.cir remain freely editable. Missing runtime vectors diagnose at prepare/result time, never end the session.",
    OutputArgs,
    async (parsed, session) => {
      const result = await read(session, parsed.folderId, parsed.documentId);
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
      );
    },
  ),
  tool(
    "simulation_measurement",
    "Manage saved per-record scalar measurements in the experiment configuration source. value, sample-at, minimum, maximum, peak-to-peak, mean and RMS share the runtime schema. A measurement may be authored before its analysis or output exists; prepare and result diagnostics identify unresolved references without blocking file editing.",
    MeasurementArgs,
    async (parsed, session) => {
      const result = await read(session, parsed.folderId, parsed.documentId);
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
      );
    },
  ),
  tool(
    "simulation_device_operating_point",
    "Select MOS occurrences for terminal-derived VGS, VDS, VBS and drain-entering ID. circuit names the generated binding and authored X callPath; occurrence addresses hierarchy inside that binding. This edits the same experiment configuration used by Code, not a second folder object. OP may be added to the native program before or after this helper.",
    DeviceArgs,
    async (parsed, session) => {
      const result = await read(session, parsed.folderId, parsed.documentId);
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
      );
    },
  ),
];
