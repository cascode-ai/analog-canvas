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
      "apply-label-preset",
    ],
  },
  {
    name: "circuit_properties",
    source: "apply_actions",
    operations: [
      "set-reference",
      "set-property",
      "set-signal-flow",
      "set-block-supply",
      "set-source-control",
      "set-model",
      "set-instance-display",
      "set-display-alias",
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
              : `Use ${source} or the matching focused tool for this operation.`,
          );
        }
        // Parse and execute with the exact original handler: revision guards,
        // idempotency, atomic planning, offline workspaces and errors stay shared.
        const result = await original.handle(args, session);
        const calls = notAtomicCalls(result);
        return source === "apply_actions" && calls
          ? splitCalls(args, calls, (part) => original.handle(part, session))
          : result;
      },
    };
  });
}

/** The calls a refused mixed call names, when it was refused only for that. */
function notAtomicCalls(
  result: unknown,
): { actionIndices: number[]; actionKinds: string[] }[] | undefined {
  const report = result as {
    ok?: unknown;
    code?: unknown;
    calls?: unknown;
  } | null;
  return report?.ok === false &&
    report.code === "ACTION_BATCH_NOT_ATOMIC" &&
    Array.isArray(report.calls) &&
    report.calls.length > 1
    ? (report.calls as { actionIndices: number[]; actionKinds: string[] }[])
    : undefined;
}

/**
 * A focused tool's actions that cannot share one transaction, sent as the
 * calls the compiler names, in order (#1231): the tool advertised them
 * together, so it splits them itself and says so. Each call is atomic; the
 * first that fails stops the rest, and the calls before it stay applied.
 */
async function splitCalls(
  args: unknown,
  calls: readonly { actionIndices: number[]; actionKinds: string[] }[],
  run: (args: unknown) => Promise<unknown>,
): Promise<unknown> {
  const actions = (args as { actions: unknown[] }).actions;
  const done: {
    actionIndices: number[];
    actionKinds: string[];
    report: any;
  }[] = [];
  for (const call of calls) {
    const report = (await run({
      ...(args as object),
      actions: call.actionIndices.map((index) => actions[index]),
    })) as any;
    done.push({ ...call, report });
    if (report?.ok === false) break;
  }
  const last = done.at(-1)!.report;
  const applied = done.filter(({ report }) => report?.ok !== false).length;
  return {
    ...(typeof last === "object" && last !== null ? last : {}),
    ok: applied === calls.length,
    split: {
      note:
        applied === calls.length
          ? `These actions cannot share one transaction, so they were sent as ${calls.length} calls in order; each call was atomic.`
          : `These actions were sent as ${calls.length} calls in order; call ${applied + 1} failed and the rest were not sent. The ${applied} before it stay applied.`,
      applied,
      calls: done.map(({ actionIndices, actionKinds, report }) => ({
        actionIndices,
        actionKinds,
        ok: report?.ok !== false,
        ...(typeof report?.revision === "number"
          ? { revision: report.revision }
          : {}),
        ...(report?.ok === false
          ? {
              ...(report.code ? { code: report.code } : {}),
              ...(report.message ? { message: report.message } : {}),
            }
          : {}),
      })),
    },
  };
}
