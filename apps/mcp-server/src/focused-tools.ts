import {
  ContractQueryError,
  selectToolSchema,
  selectedArgumentOperations,
  type ContractTool,
} from "./tool-contracts.js";

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
      "resource-usage",
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
    // A Cell's body default goes with its supplies: circuit_wire and
    // circuit_properties are at the host's 5,000-byte budget (#1520).
    operations: [
      "place-component",
      "place-cell",
      "place-existing",
      "add-power-rail",
      "set-mos-bulk-default",
      "render-net-as",
    ],
  },
  {
    name: "circuit_wire",
    source: "apply_actions",
    // A relocation redraws the wires of the parts it moves; circuit_transform
    // and circuit_selection are at the host's declaration budget.
    operations: ["connect", "disconnect", "delete-wires", "relocate"],
  },
  {
    name: "circuit_transform",
    source: "apply_actions",
    // A Cell's block Pins are arranged here: circuit_properties is at the
    // host's 5,000-byte declaration budget (#1320).
    operations: [
      "move",
      "rotate",
      "mirror",
      "set-orientation",
      "arrange",
      "detach-move",
      "extend-power-rail",
      "set-cell-symbol-pins",
      "set-cell-pin-order",
      "set-cell-symbol-size",
    ],
  },
  {
    name: "circuit_selection",
    source: "apply_actions",
    // Two inductors are coupled from the canvas menu of their selection. A
    // Cell's own block artwork is here: circuit_transform, beside the other
    // block edits, is at the host's declaration budget.
    operations: [
      "transform",
      "copy",
      "align",
      "couple-inductors",
      "set-cell-symbol-artwork",
    ],
  },
  {
    // The view a person watching sees: fit, select, highlight (#1444). Its own
    // tool, since the intent schema would push circuit_selection past the
    // host's 5,000-byte declaration budget.
    name: "circuit_view",
    source: "apply_actions",
    operations: ["focus"],
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
      "apply-label-preset",
      // A name label's drawn text: circuit_properties is at the host's
      // 5,000-byte declaration budget (#2443).
      "set-display-alias",
    ],
  },
  {
    name: "circuit_properties",
    source: "apply_actions",
    operations: [
      "set-reference",
      "set-property",
      "set-signal-flow",
      // set-terminal-net covers set-block-supply (pin VDD or VSS), which
      // apply_actions still takes; both together exceed the host budget.
      "set-terminal-net",
      "set-source-control",
      "set-switch-control",
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
    // Derived from the original's contract on first read, which is converted
    // only then (#1227).
    let derived: ContractTool["inputSchema"] | undefined;
    const inputSchema = () => {
      if (!derived) {
        const selectedSchema = selectToolSchema(
          original.definition.inputSchema,
          operations,
        );
        derived =
          source === "simulation_files"
            ? canonicalSimulationSchema(selectedSchema)
            : selectedSchema;
      }
      return derived;
    };
    return {
      definition: {
        name,
        description: help(name),
        get inputSchema() {
          return inputSchema();
        },
      },
      async handle(args: unknown, session: S) {
        // The shared operation boundary has settled aliases and envelopes.
        const selected = selectedArgumentOperations(inputSchema(), args);
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
              : `${name} takes ${source === "apply_actions" ? "kind" : "operation"} ${operations.join(", ")}; use ${source} or the matching focused tool for any other.`,
          );
        }
        // Parse and execute with the exact original handler: revision guards,
        // idempotency, atomic planning, offline workspaces and errors stay
        // shared. A list needing several transactions commits them together
        // in the editor, as one Undo step or not at all.
        return original.handle(args, session);
      },
    };
  });
}
