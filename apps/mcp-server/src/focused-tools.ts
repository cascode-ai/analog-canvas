import {
  ContractQueryError,
  selectToolSchema,
  selectedArgumentOperations,
  type ContractTool,
} from "./tool-contracts.js";

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
    operations: ["catalog", "history", "export"],
  },
  {
    name: "simulation_run",
    source: "simulation",
    operations: [
      "capabilities",
      "authoring-help",
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
    operations: ["move", "rotate", "mirror", "arrange", "detach-move"],
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
    ],
  },
  {
    name: "circuit_properties",
    source: "apply_actions",
    operations: [
      "set-reference",
      "set-property",
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
    const inputSchema = selectToolSchema(
      original.definition.inputSchema,
      operations,
    );
    return {
      definition: { name, description: help(name), inputSchema },
      async handle(args: unknown, session: S) {
        const selected = selectedArgumentOperations(inputSchema, args);
        if (selected.some((operation) => !allowed.has(operation)))
          throw new ContractQueryError(
            "INVALID_TOOL_OPERATION",
            `Use ${source} or the matching focused tool for this operation.`,
          );
        // Parse and execute with the exact original handler: revision guards,
        // idempotency, atomic planning, offline workspaces and errors stay shared.
        return original.handle(args, session);
      },
    };
  });
}
