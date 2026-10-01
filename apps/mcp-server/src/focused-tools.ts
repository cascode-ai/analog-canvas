import {
  ContractQueryError,
  selectToolSchema,
  selectedArgumentOperations,
  type ContractTool,
} from "./tool-contracts.js";

function normalizeFocusedArgs(args: unknown, source: string) {
  if (!args || typeof args !== "object") return args;
  const value = args as { request?: unknown };
  if (!value.request || typeof value.request !== "object") return args;
  const request = value.request as Record<string, unknown>;
  const from = source === "simulation_files" ? "operation" : "action";
  const to = from === "action" ? "operation" : "action";
  if (typeof request[from] !== "string" || request[to] !== undefined)
    return args;
  const { [from]: discriminator, ...rest } = request;
  return { ...value, request: { ...rest, [to]: discriminator } };
}

export function canonicalSimulationSchema(schema: Record<string, unknown>) {
  const copy = structuredClone(schema) as Record<string, any>;
  const request = copy.properties?.request;
  const key = request?.oneOf ? "oneOf" : request?.anyOf ? "anyOf" : undefined;
  if (!key) return copy;
  request[key] = request[key].map((branch: Record<string, any>) => {
    if (!branch.properties?.action) return branch;
    const { action, ...properties } = branch.properties;
    return {
      ...branch,
      properties: { ...properties, operation: action },
      required: (branch.required ?? []).map((name: string) =>
        name === "action" ? "operation" : name,
      ),
    };
  });
  return copy;
}

/** A routing map, not a second parameter contract or an execution engine. */
export const FOCUSED_TOOLS = [
  {
    name: "simulation_source",
    source: "simulation_files",
    operations: ["list", "create", "read", "discard"],
  },
  {
    name: "simulation_edit",
    source: "simulation_files",
    operations: ["update"],
  },
  {
    name: "simulation_data",
    source: "simulation_files",
    operations: ["workspace", "sync", "download", "artifact"],
  },
  {
    name: "simulation_plot",
    source: "simulation_files",
    operations: ["prepare-plot"],
  },
  {
    name: "simulation_results",
    source: "simulation",
    operations: [
      "catalog",
      "history",
      "history-usage",
      "history-delete",
      "export",
    ],
  },
  {
    name: "simulation_run",
    source: "simulation",
    operations: [
      "capabilities",
      "authoring-help",
      "run",
      "prepare",
      "start",
      "read",
      "cancel",
    ],
  },
  {
    name: "simulation_batch",
    source: "simulation",
    operations: [
      "prepare-batch",
      "prepare-sweep",
      "start-batch",
      "read-batch",
      "cancel-batch",
    ],
  },
  {
    name: "circuit_place",
    source: "apply_actions",
    operations: [
      "place-component",
      "place-cell",
      "place-existing",
      "add-power-rail",
    ],
  },
  {
    name: "circuit_wire",
    source: "apply_actions",
    operations: ["connect", "disconnect"],
  },
  {
    name: "circuit_transform",
    source: "apply_actions",
    operations: [
      "move",
      "rotate",
      "mirror",
      "arrange",
      "detach-move",
      "extend-power-rail",
    ],
  },
  {
    name: "circuit_selection",
    source: "apply_actions",
    operations: ["transform", "copy", "align"],
  },
  {
    name: "circuit_text",
    source: "apply_actions",
    operations: [
      "add-label",
      "edit-text",
      "annotate",
      "move-annotation",
      "set-net-label",
      "arrange-labels",
    ],
  },
  {
    name: "circuit_properties",
    source: "apply_actions",
    operations: [
      "set-reference",
      "set-property",
      "set-source-control",
      "set-model",
      "set-instance-display",
    ],
  },
] as const;

export function focusedTools<S>(
  originals: readonly {
    definition: ContractTool;
    handle: (args: unknown, session: S) => Promise<unknown>;
  }[],
  help: (name: (typeof FOCUSED_TOOLS)[number]["name"]) => string,
) {
  return FOCUSED_TOOLS.map(({ name, source, operations }) => {
    const original = originals.find((tool) => tool.definition.name === source);
    if (!original) throw new Error(`Missing canonical tool ${source}`);
    const allowed = new Set<string>(operations);
    const selectedSchema = selectToolSchema(
      original.definition.inputSchema,
      operations,
    );
    const inputSchema =
      source === "simulation_files"
        ? canonicalSimulationSchema(selectedSchema)
        : selectedSchema;
    return {
      definition: { name, description: help(name), inputSchema },
      async handle(args: unknown, session: S) {
        const selected = selectedArgumentOperations(inputSchema, args);
        const invalid = selected.find((operation) => !allowed.has(operation));
        if (invalid) {
          const owner = FOCUSED_TOOLS.find(
            (candidate) =>
              candidate.name !== name &&
              (candidate.operations as readonly string[]).includes(invalid),
          )?.name;
          throw new ContractQueryError(
            "INVALID_TOOL_OPERATION",
            owner
              ? `${invalid} is served by ${owner}.`
              : `Use ${source} or the matching focused tool for this operation.`,
          );
        }
        // Parse and execute with the exact original handler: revision guards,
        // idempotency, atomic planning, offline workspaces and errors stay shared.
        return original.handle(normalizeFocusedArgs(args, source), session);
      },
    };
  });
}
