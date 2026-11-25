import { reviewedExternalBindingForMaster } from "@icm/devices";
import {
  parseSpiceNumber,
  type InstanceStatement,
  type SpiceStatement,
} from "@icm/spice";
import type { SimulationSourceGraph } from "@icm/netlist";

/** Physical floor (1 Å = 0.1 nm): a device dimension smaller than an atom after
 * applying `.option scale` is reliably a metric/micron double-scaling bug. */
const SUB_ATOMIC_METERS = 1e-10;
const SKY130_LIBRARY_ID = "sky130_fd_pr";
const IDEAL_SWITCH_MODEL_NAME = "ideal_switch";

export interface NgspiceAdvisoryContext {
  readonly profileId: string;
  readonly profileDevices?: readonly string[];
  readonly dependencies: readonly { id: string; mountPath: string }[];
}

interface ScopedStatement {
  readonly path: string;
  readonly scope: string | null;
  readonly statement: SpiceStatement;
}

interface CallSite {
  readonly callerScope: string | null;
  readonly args: ReadonlyMap<string, string>;
}

interface IndexedDeck {
  readonly graph: SimulationSourceGraph;
  readonly scoped: readonly ScopedStatement[];
  readonly reachable: ReadonlySet<string>;
  readonly subcktDefaults: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly callsBySubckt: ReadonlyMap<string, readonly CallSite[]>;
}

function normalizedCommand(statement: SpiceStatement): string | null {
  if (statement.kind !== "directive" && statement.kind !== "control_command")
    return null;
  return (statement.kind === "directive" ? statement.name : statement.command)
    .replace(/^\./u, "")
    .toLowerCase();
}

function indexPreparedDeck(graph: SimulationSourceGraph): IndexedDeck {
  const scoped: ScopedStatement[] = [];
  const subcktDefaults = new Map<string, Map<string, string>>();
  const topLevelCalls: InstanceStatement[] = [];
  const subcktCalls = new Map<string, InstanceStatement[]>();
  const scopes: string[] = [];
  let topLevelInstances = 0;

  for (const { path, statement } of graph.statements) {
    if (statement.kind === "subckt_start") {
      const name = statement.name.toLowerCase();
      scopes.push(name);
      const defaults = new Map<string, string>();
      for (const param of statement.parameters) {
        defaults.set(param.name.toLowerCase(), param.rawText);
      }
      subcktDefaults.set(name, defaults);
      continue;
    }
    if (statement.kind === "subckt_end") {
      scopes.pop();
      continue;
    }
    const scope = scopes.at(-1) ?? null;
    scoped.push({ path, scope, statement });
    if (statement.kind !== "instance") continue;
    if (scope === null) topLevelInstances += 1;
    if (statement.family === "subcircuit") {
      if (scope === null) topLevelCalls.push(statement);
      else {
        const list = subcktCalls.get(scope) ?? [];
        list.push(statement);
        subcktCalls.set(scope, list);
      }
    }
  }

  const reachable = new Set<string>();
  const callsBySubckt = new Map<string, CallSite[]>();
  const recordCall = (callerScope: string | null, call: InstanceStatement) => {
    const master = call.master?.toLowerCase();
    if (!master) return;
    const args = new Map<string, string>();
    for (const param of call.parameters) {
      args.set(param.name.toLowerCase(), param.rawText);
    }
    const entries = callsBySubckt.get(master) ?? [];
    entries.push({ callerScope, args });
    callsBySubckt.set(master, entries);
  };

  const queue: string[] = [];
  const enqueue = (call: InstanceStatement) => {
    const master = call.master?.toLowerCase();
    if (master && !reachable.has(master) && subcktDefaults.has(master)) {
      reachable.add(master);
      queue.push(master);
    }
  };
  for (const call of topLevelCalls) {
    recordCall(null, call);
    enqueue(call);
  }
  if (topLevelInstances > 0) {
    while (queue.length) {
      const current = queue.shift()!;
      for (const call of subcktCalls.get(current) ?? []) {
        recordCall(current, call);
        enqueue(call);
      }
    }
  } else {
    // Starter or subcircuit-only decks have no top-level instances yet;
    // inspect every authored/generated subcircuit in the closure.
    for (const name of subcktDefaults.keys()) reachable.add(name);
    for (const [callerScope, calls] of subcktCalls) {
      for (const call of calls) recordCall(callerScope, call);
    }
  }

  return { graph, scoped, reachable, subcktDefaults, callsBySubckt };
}

function isReachableScope(deck: IndexedDeck, scope: string | null): boolean {
  return scope === null || deck.reachable.has(scope);
}

/**
 * Advisory for ngspice-46's `SWacLoad` bug: SPICE3 `SW` switches (`ideal_switch`,
 * `ideal_chopper`, `ideal_spdt`) contribute zero small-signal conductance in
 * `.ac`, silently making switched paths behave as open circuits.
 */
function switchAcAnalysisWarning(deck: IndexedDeck): string | null {
  if (
    !deck.graph.statements.some(
      ({ statement }) => normalizedCommand(statement) === "ac",
    )
  )
    return null;
  const modelsByScope = new Map<string, Map<string, string>>();
  for (const { scope, statement } of deck.scoped) {
    if (statement.kind !== "model") continue;
    const key = scope ?? "";
    const models = modelsByScope.get(key) ?? new Map<string, string>();
    models.set(statement.name.toLowerCase(), statement.modelType.toLowerCase());
    modelsByScope.set(key, models);
  }
  for (const { scope, statement } of deck.scoped) {
    if (!isReachableScope(deck, scope)) continue;
    if (statement.kind !== "instance" || statement.family !== "switch")
      continue;
    const master = statement.master?.toLowerCase();
    const modelType = master
      ? (modelsByScope.get(scope ?? "")?.get(master) ??
        modelsByScope.get("")?.get(master))
      : undefined;
    if (
      modelType === "sw" ||
      (modelType === undefined && master === IDEAL_SWITCH_MODEL_NAME)
    ) {
      return `This deck runs AC analysis with ngspice SW switch ${statement.name}${statement.master ? ` (${statement.master})` : ""}. In ngspice-46, SWacLoad contributes zero small-signal conductance in .ac, so switched paths behave as open circuits; use .tran or replace static switch paths with fixed elements for AC sweeps.`;
    }
  }
  return null;
}

function unwrapSpiceExpression(rawValue: string): string {
  let current = rawValue.trim();
  while (
    current.length >= 2 &&
    ((current.startsWith("{") && current.endsWith("}")) ||
      (current.startsWith("'") && current.endsWith("'")))
  ) {
    current = current.slice(1, -1).trim();
  }
  return current;
}

function bareParameterReference(rawValue: string): string | null {
  const match = /^[a-z_][a-z0-9_]*$/iu.exec(unwrapSpiceExpression(rawValue));
  return match ? match[0].toLowerCase() : null;
}

function explicitOptionScale(
  graph: SimulationSourceGraph,
): { value: number; raw: string } | null {
  let found: { value: number; raw: string } | null = null;
  for (const { statement } of graph.statements) {
    if (statement.kind !== "directive") continue;
    const name = statement.name.toLowerCase();
    if (name !== "option" && name !== "options") continue;
    const args = statement.arguments;
    for (let i = 0; i < args.length; i++) {
      const token = args[i]!;
      const lower = token.toLowerCase();
      let raw: string | undefined;
      const inline = /^scale\s*=\s*(.+)$/iu.exec(token);
      if (inline) {
        raw = inline[1]!.trim();
      } else if (lower === "scale=" && args[i + 1]) {
        raw = args[i + 1]!.trim();
        i += 1;
      } else if (lower === "scale" && args[i + 1]) {
        const next = args[i + 1]!;
        if (next === "=" && args[i + 2]) {
          raw = args[i + 2]!.trim();
          i += 2;
        } else if (next.startsWith("=") && next.length > 1) {
          raw = next.slice(1).trim();
          i += 1;
        }
      }
      if (!raw) continue;
      const parsed = parseSpiceNumber(unwrapSpiceExpression(raw));
      if (parsed && parsed.value > 0) found = { value: parsed.value, raw };
    }
  }
  return found;
}

function isSky130Master(master: string | undefined): boolean {
  if (!master) return false;
  return (
    reviewedExternalBindingForMaster(master)?.libraryId === SKY130_LIBRARY_ID ||
    master.toLowerCase().startsWith(`${SKY130_LIBRARY_ID}__`)
  );
}

function isScaledGeometryDevice(statement: InstanceStatement): boolean {
  return (
    statement.family === "mosfet" ||
    (statement.family === "subcircuit" && isSky130Master(statement.master))
  );
}

function activeScaleFactor(
  deck: IndexedDeck,
  context: NgspiceAdvisoryContext,
): { value: number; label: string } | null {
  const explicit = explicitOptionScale(deck.graph);
  if (explicit) {
    return explicit.value < 1e-3
      ? { value: explicit.value, label: `.option scale=${explicit.raw}` }
      : null;
  }
  const loadedTargets = new Set(deck.graph.includes.map((inc) => inc.target));
  const loadedDeps = context.dependencies.filter((dep) =>
    loadedTargets.has(dep.mountPath),
  );
  if (!loadedDeps.length) return null;
  const profileServesSky130 = (context.profileDevices ?? []).some(
    (name) =>
      reviewedExternalBindingForMaster(name)?.libraryId === SKY130_LIBRARY_ID,
  );
  const deckCallsSky130 = deck.scoped.some(
    ({ scope, statement }) =>
      isReachableScope(deck, scope) &&
      statement.kind === "instance" &&
      statement.family === "subcircuit" &&
      isSky130Master(statement.master),
  );
  const usesSky130Library =
    deckCallsSky130 ||
    profileServesSky130 ||
    loadedDeps.some((dep) => dep.id.toLowerCase().startsWith("sky130")) ||
    context.profileId.toLowerCase().startsWith("sky130");
  return usesSky130Library
    ? { value: 1e-6, label: "SKY130 .option scale=1.0u" }
    : null;
}

function resolveSubcircuitParamValues(
  deck: IndexedDeck,
  subcktName: string,
  paramName: string,
  visited = new Set<string>(),
): string[] {
  const visitKey = `${subcktName}\u0000${paramName}`;
  if (visited.has(visitKey)) return [];
  visited.add(visitKey);
  const defaults = deck.subcktDefaults.get(subcktName);
  const calls = deck.callsBySubckt.get(subcktName) ?? [];
  const results: string[] = [];
  const collectExpr = (expr: string, callerScope: string | null) => {
    const unwrapped = unwrapSpiceExpression(expr);
    if (parseSpiceNumber(unwrapped)) {
      results.push(expr);
      return;
    }
    const ref = bareParameterReference(expr);
    if (ref && callerScope !== null) {
      results.push(
        ...resolveSubcircuitParamValues(deck, callerScope, ref, visited),
      );
    }
  };
  if (calls.length === 0) {
    const fallback = defaults?.get(paramName);
    if (fallback !== undefined) collectExpr(fallback, null);
    return results;
  }
  for (const call of calls) {
    const passed = call.args.get(paramName);
    if (passed !== undefined) {
      collectExpr(passed, call.callerScope);
    } else {
      const fallback = defaults?.get(paramName);
      if (fallback !== undefined) collectExpr(fallback, null);
    }
  }
  return results;
}

function subAtomicDimensionWarning(input: {
  instance: string;
  param: string;
  rawText: string;
  resolvedValue?: string;
  path: string;
  scaleLabel: string;
}): string {
  const where = input.resolvedValue
    ? `(resolved to ${input.resolvedValue} in ${input.path})`
    : `(${input.path})`;
  const fix = input.resolvedValue
    ? "Express W/L in micrometres under scale=1u or convert metres to micrometres in the wrapper."
    : "Express W/L in micrometres under scale=1u or avoid mixing metric M/model-source devices with a scale=1u library.";
  return `Metric device dimension ${input.instance} ${input.param}=${input.rawText} ${where} will be scaled again by ${input.scaleLabel} (below 0.1 nm), which can fail with "could not find a valid modelname" or produce wrong device geometry. ${fix}`;
}

/**
 * Advisory for metric W/L dimensions (e.g. `l=150n`, `w=1u`) evaluated under
 * SKY130's global `.option scale=1.0u` (or an explicit sub-millimetre scale),
 * which scales them a second time into sub-atomic lengths (< 0.1 nm).
 */
function scaleMetricDimensionWarning(
  deck: IndexedDeck,
  context: NgspiceAdvisoryContext,
): string | null {
  const scale = activeScaleFactor(deck, context);
  if (!scale) return null;
  for (const { path, scope, statement } of deck.scoped) {
    if (!isReachableScope(deck, scope)) continue;
    if (statement.kind !== "instance" || !isScaledGeometryDevice(statement))
      continue;
    for (const param of statement.parameters) {
      const key = param.name.toLowerCase();
      if (key !== "w" && key !== "l") continue;
      const direct = parseSpiceNumber(unwrapSpiceExpression(param.rawText));
      if (
        direct &&
        direct.value > 0 &&
        direct.value * scale.value < SUB_ATOMIC_METERS
      ) {
        return subAtomicDimensionWarning({
          instance: statement.name,
          param: param.name,
          rawText: param.rawText,
          path,
          scaleLabel: scale.label,
        });
      }
      if (!direct && scope !== null) {
        const ref = bareParameterReference(param.rawText);
        if (!ref) continue;
        for (const concrete of resolveSubcircuitParamValues(deck, scope, ref)) {
          const parsed = parseSpiceNumber(unwrapSpiceExpression(concrete));
          if (
            parsed &&
            parsed.value > 0 &&
            parsed.value * scale.value < SUB_ATOMIC_METERS
          ) {
            return subAtomicDimensionWarning({
              instance: statement.name,
              param: param.name,
              rawText: param.rawText,
              resolvedValue: concrete,
              path,
              scaleLabel: scale.label,
            });
          }
        }
      }
    }
  }
  return null;
}

/** Non-blocking ngspice-46 preparation advisories over the final prepared deck. */
export function ngspicePreparationWarnings(
  graph: SimulationSourceGraph,
  context: NgspiceAdvisoryContext,
): string[] {
  const deck = indexPreparedDeck(graph);
  return [
    switchAcAnalysisWarning(deck),
    scaleMetricDimensionWarning(deck, context),
  ].filter((warning): warning is string => warning !== null);
}
