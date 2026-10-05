import { z } from "zod";

import {
  AuthoringActionSchema,
  type AuthoringAction,
} from "./authoring-actions.js";
import {
  AgentAuthoringCommandSchema,
  isBatchableAuthoringCommand,
} from "./authoring-command.js";
import {
  ActionCompileError,
  compileActions,
  describeCallSplit,
  directConnectIntent,
  nativeForm,
  splitIntoCalls,
  type ActionCall,
  type CompiledTransaction,
} from "./authoring-helper.js";
import type { AgentSessionSnapshot } from "./schema.js";

/** The diagnostics a transaction answers with, as far as naming reads them. */
export type PlannedDiagnostics =
  | readonly {
      path?: readonly unknown[] | undefined;
      parameters?: Record<string, unknown> | undefined;
    }[]
  | undefined;

/**
 * How one call's action list is sent: what the Agent client did on its own
 * before the editor could plan actions, and what the editor now does with a
 * transaction's `actions`. Both sides run this, so one list gets one answer.
 */
export type ActionPlan =
  /** The list is malformed, or names what the Document does not hold. */
  | {
      kind: "refused";
      message: string;
      actionIndex: number;
      actionKind: string;
      /** Whether the Document was read to find that out. */
      readSnapshot: boolean;
    }
  /** One transaction carries the whole list. */
  | {
      kind: "send";
      payload: Record<string, unknown>;
      /** The list as sent, for naming a refused action's kind. */
      actions: readonly AuthoringAction[];
      /** Whether the payload was planned from the Document as read. */
      readSnapshot: boolean;
      /** Which action a refusal names, if the transaction says. */
      actionIndexOf: (diagnostics: PlannedDiagnostics) => number | undefined;
      /**
       * A compiled transaction maps the refusal back to the list even when
       * the editor named an item of its own; otherwise the editor's naming
       * stands.
       */
      naming: "if-unnamed" | "override";
    }
  /** The list asks for no change. */
  | { kind: "nothing" }
  /** The list needs several transactions; these are the calls to send. */
  | {
      kind: "split";
      message: string;
      transactions: number;
      calls: ActionCall[];
    };

/** The first diagnostic parameter named `name` that is a number. */
function numberParameter(
  diagnostics: PlannedDiagnostics,
  name: string,
): number | undefined {
  return diagnostics?.flatMap((diagnostic) => {
    const value = diagnostic.parameters?.[name];
    return typeof value === "number" ? [value] : [];
  })[0];
}

/** Which action a refused single transaction names, if it says. */
function compiledActionIndex(
  transaction: CompiledTransaction,
  diagnostics: PlannedDiagnostics,
): number | undefined {
  if (transaction.form === "edits") {
    const editIndex = diagnostics?.flatMap((diagnostic) =>
      diagnostic.path?.[0] === "edits" && typeof diagnostic.path[1] === "number"
        ? [diagnostic.path[1]]
        : [],
    )[0];
    return editIndex === undefined
      ? undefined
      : transaction.editActionIndices?.[editIndex];
  }
  const instanceIndex = numberParameter(diagnostics, "instanceIndex");
  if (
    transaction.command?.kind === "place-components" &&
    instanceIndex !== undefined
  )
    return transaction.editActionIndices?.[instanceIndex];
  // The editor names a command's failing item; a batch of commands joins
  // several actions, one command is one action (#1231).
  const itemIndex = numberParameter(diagnostics, "actionIndex");
  if (transaction.command?.kind === "batch" && itemIndex !== undefined)
    return transaction.actionIndices?.[itemIndex];
  return transaction.actionIndices?.length === 1
    ? transaction.actionIndices[0]
    : undefined;
}

/**
 * Plan one call's action list into the single transaction that carries it,
 * reading the Document only when the list needs it. A friendlier place-cell,
 * set-model or set-display-alias goes native without the Document (#1301);
 * wires alone, one command, and batchable commands go as they are; anything
 * else compiles against the Document, which allocates the IDs it makes.
 */
export async function planActions(
  actions: readonly unknown[],
  options: {
    allocateId: (prefix: string) => string;
    snapshot: () => AgentSessionSnapshot | Promise<AgentSessionSnapshot>;
    maxEditsPerTransaction: () => number;
  },
): Promise<ActionPlan> {
  const parsed = z.array(AuthoringActionSchema).safeParse(actions);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      kind: "refused",
      message: issue
        ? `${issue.path.join(".")}: ${issue.message}`
        : "invalid action",
      actionIndex: Number(issue?.path[0] ?? 0) || 0,
      actionKind: "schema",
      readSnapshot: false,
    };
  }
  const direct = parsed.data.map((action) =>
    nativeForm(action, options.allocateId),
  );
  if (
    direct.length > 0 &&
    direct.length <= 64 &&
    direct.every((action) => action.kind === "connect")
  ) {
    const wires = direct.map((action) =>
      directConnectIntent(action, options.allocateId),
    );
    if (wires.every((wire) => wire !== undefined))
      return {
        kind: "send",
        payload: { wireIntent: wires.length === 1 ? wires[0] : wires },
        actions: direct,
        readSnapshot: false,
        actionIndexOf: () => (direct.length === 1 ? 0 : undefined),
        naming: "if-unnamed",
      };
  }
  if (direct.length === 1) {
    const action = direct[0]!;
    const command = AgentAuthoringCommandSchema.safeParse(action);
    if (
      command.success ||
      action.kind === "focus" ||
      action.kind === "undo" ||
      action.kind === "redo"
    )
      return {
        kind: "send",
        payload:
          action.kind === "focus"
            ? { semanticIntent: action.intent }
            : action.kind === "undo" || action.kind === "redo"
              ? { edits: [{ kind: action.kind }] }
              : { command: command.data },
        actions: direct,
        readSnapshot: false,
        actionIndexOf: () => 0,
        naming: "if-unnamed",
      };
  }
  if (
    direct.length > 1 &&
    direct.length <= 64 &&
    direct.every(
      (action) =>
        isBatchableAuthoringCommand(action) &&
        AgentAuthoringCommandSchema.safeParse(action).success,
    )
  )
    // The batch's items are these actions, in order.
    return {
      kind: "send",
      payload: { command: { kind: "batch", commands: direct } },
      actions: direct,
      readSnapshot: false,
      actionIndexOf: (diagnostics) =>
        numberParameter(diagnostics, "actionIndex"),
      naming: "if-unnamed",
    };

  const snapshot = await options.snapshot();
  let compiled: CompiledTransaction[];
  try {
    compiled = compileActions(actions, {
      snapshot,
      allocateId: options.allocateId,
      maxEditsPerTransaction: options.maxEditsPerTransaction(),
    });
  } catch (error) {
    if (!(error instanceof ActionCompileError)) throw error;
    return {
      kind: "refused",
      message: error.message,
      actionIndex: error.index,
      actionKind: error.actionKind,
      readSnapshot: true,
    };
  }
  if (
    compiled.length > 1 &&
    compiled.every((item) => item.form === "wire-intent")
  )
    return {
      kind: "send",
      payload: { wireIntent: compiled.map((item) => item.wireIntent!) },
      actions: direct,
      readSnapshot: true,
      actionIndexOf: () => undefined,
      naming: "if-unnamed",
    };
  const batchCommands = compiled.flatMap((item) =>
    item.form === "command" &&
    item.command &&
    isBatchableAuthoringCommand(item.command)
      ? [item.command]
      : [],
  );
  if (
    compiled.length > 1 &&
    compiled.length <= 64 &&
    batchCommands.length === compiled.length
  )
    return {
      kind: "send",
      payload: { command: { kind: "batch", commands: batchCommands } },
      actions: direct,
      readSnapshot: true,
      actionIndexOf: () => undefined,
      naming: "if-unnamed",
    };
  if (compiled.length === 0) return { kind: "nothing" };
  if (compiled.length !== 1) {
    const calls = splitIntoCalls(compiled);
    return {
      kind: "split",
      message: describeCallSplit(calls),
      transactions: compiled.length,
      calls,
    };
  }
  const transaction = compiled[0]!;
  return {
    kind: "send",
    payload:
      transaction.form === "edits"
        ? { edits: transaction.edits }
        : transaction.form === "command"
          ? { command: transaction.command }
          : transaction.form === "semantic"
            ? { semanticIntent: transaction.semanticIntent }
            : { wireIntent: transaction.wireIntent },
    actions: direct,
    readSnapshot: true,
    actionIndexOf: (diagnostics) =>
      compiledActionIndex(transaction, diagnostics),
    naming: "override",
  };
}

/**
 * What a refused transaction says about the action it concerns: its index,
 * its kind and a message that begins `actions[i] (kind):`. Undefined when
 * the transaction does not say, or when the editor's own naming stands.
 */
export function actionRefusalNaming(
  plan: Extract<ActionPlan, { kind: "send" }>,
  refusal: {
    message?: string | undefined;
    actionIndex?: number | undefined;
    diagnostics?: PlannedDiagnostics;
  },
): { actionIndex: number; actionKind?: string; message: string } | undefined {
  if (plan.naming === "if-unnamed" && refusal.actionIndex !== undefined)
    return undefined;
  const actionIndex = plan.actionIndexOf(refusal.diagnostics);
  if (actionIndex === undefined) return undefined;
  const actionKind = plan.actions[actionIndex]?.kind;
  if (plan.naming === "if-unnamed" && !actionKind) return undefined;
  return {
    actionIndex,
    ...(actionKind ? { actionKind } : {}),
    message: `actions[${actionIndex}]${actionKind ? ` (${actionKind})` : ""}: ${(refusal.message ?? "transaction rejected").replace(/^actions\[\d+\]: /u, "")}`,
  };
}
