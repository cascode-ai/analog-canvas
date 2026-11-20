import type { CircuitProject } from "@icm/model";
import {
  compileSpiceSources,
  decodeSourceContent,
  importCompileResult,
  statementLedger,
  type SpiceCompileOptions,
  type SpiceDiagnostic,
  type SpiceImportOptions,
  type SpiceSourceInput,
  type StatementFateKind,
  type StatementLedger,
  type StatementLedgerEntry,
} from "@icm/spice";
import {
  prepareImportSources,
  type NativeStatementLine,
} from "./convert-import-sources";

/**
 * How one caller reads netlist sources: the evidence it holds beyond the
 * files themselves. Every entry (File / Open, an Agent's local circuit, a
 * review's reference, RNL) reads through the same import; they differ only
 * in the evidence they bring.
 */
export interface NetlistImportPolicy {
  /** Device types of models the sources call but no card declares, by
   * name, as the caller states them. A card the sources give decides. */
  modelTypes?: Readonly<Record<string, string>>;
  namingProfile?: SpiceImportOptions["namingProfile"];
  compileOptions?: SpiceCompileOptions;
}

export type NetlistSourceImport = (
  | { status: "imported"; project: CircuitProject }
  | { status: "refused" }
) & {
  diagnostics: SpiceDiagnostic[];
  /** Every statement of the files the entry reaches, with its fate. */
  ledger: StatementLedger;
};

const FATE_PRIORITY: readonly StatementFateKind[] = [
  "refused",
  "unresolved",
  "instance",
  "definition",
  "declaration",
  "preserved",
];

const DROPPED_FATE: Record<
  NonNullable<NativeStatementLine["dropped"]>,
  [StatementFateKind, string]
> = {
  "dialect switch": ["preserved", "dialect switch"],
  "native model card": ["declaration", "native model card, not converted"],
  "subcircuit parameters": ["declaration", "subcircuit parameters"],
  "built-in body": ["definition", "built-in body"],
  "no output": ["preserved", "no SPICE form"],
};

/**
 * The ledger by the files the user gave: a native Spectre file by its own
 * lines, each statement with the fate of what it converted to, or, where it
 * converted to nothing, the reason it did.
 */
function sourceLedger(
  compiled: StatementLedger,
  reached: readonly string[],
  inputs: readonly SpiceSourceInput[],
  prepared: ReturnType<typeof prepareImportSources>,
): StatementLedger {
  const native = new Set(prepared.nativeStatements.keys());
  const converted = new Map<string, StatementLedgerEntry[]>();
  const files: string[] = [];
  const reach = (path: string) => {
    if (!files.includes(path)) files.push(path);
  };
  const spice = new Map<string, StatementLedgerEntry[]>();
  for (const path of reached) {
    const origin = prepared.originalLocation(path, 1)?.path ?? path;
    reach(origin);
  }
  for (const entry of compiled.entries) {
    const origin = prepared.originalLocation(entry.path, entry.line);
    if (origin && native.has(origin.path)) {
      const at = `${origin.path}:${origin.line}`;
      converted.set(at, [
        ...(converted.get(at) ?? []),
        { ...entry, path: origin.path, line: origin.line, endLine: origin.line },
      ]);
    } else {
      reach(entry.path);
      spice.set(entry.path, [...(spice.get(entry.path) ?? []), entry]);
    }
  }
  const entries = files.flatMap((path): StatementLedgerEntry[] => {
    if (!native.has(path)) return spice.get(path) ?? [];
    const lines = decodeSourceContent(
      inputs.find((input) => input.path === path)!.bytes,
    ).text.split(/\r\n?|\n/u);
    const statements = [
      ...new Map(
        prepared.nativeStatements
          .get(path)!
          .map((statement) => [statement.line, statement]),
      ).values(),
    ].sort((a, b) => a.line - b.line);
    return statements.map((statement) => {
      const text = lines[statement.line - 1]?.trim().slice(0, 160) ?? "";
      const matched = converted.get(`${path}:${statement.line}`) ?? [];
      const chosen = FATE_PRIORITY.map((fate) =>
        matched.find((entry) => entry.fate === fate),
      ).find(Boolean);
      if (chosen) return { ...chosen, text };
      const [fate, reason] = statement.dropped
        ? DROPPED_FATE[statement.dropped]
        : (["unknown", "no accounted output"] as const);
      return {
        path,
        line: statement.line,
        endLine: statement.line,
        fate,
        reason,
        text,
      };
    });
  });
  return {
    entries,
    complete: entries.every(({ fate }) => fate !== "unknown"),
  };
}

export async function importNetlistSources(
  inputs: readonly SpiceSourceInput[],
  entryPath: string,
  policy: NetlistImportPolicy = {},
): Promise<NetlistSourceImport> {
  const prepared = prepareImportSources(inputs);
  const compiled = await compileSpiceSources(
    prepared.inputs,
    entryPath,
    policy.compileOptions ?? {},
  );
  const result = importCompileResult(compiled, {
    originalSources: inputs,
    builtInBodies: prepared.builtInBodies,
    modelTypes: new Map([
      ...Object.entries(policy.modelTypes ?? {}),
      ...prepared.modelTypes,
    ]),
    declaredModelNames: [...prepared.modelTypes.keys()],
    ...(policy.namingProfile ? { namingProfile: policy.namingProfile } : {}),
  });
  const diagnostics = [...prepared.diagnostics, ...result.diagnostics];
  const ledger = sourceLedger(
    statementLedger(compiled, result),
    compiled.bundle.files.map(({ path }) => path),
    inputs,
    prepared,
  );
  return result.successful && result.project
    ? { status: "imported", project: result.project, diagnostics, ledger }
    : { status: "refused", diagnostics, ledger };
}
