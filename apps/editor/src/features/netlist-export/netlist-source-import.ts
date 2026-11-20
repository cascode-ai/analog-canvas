import type { CircuitProject } from "@icm/model";
import {
  compileSpiceSources,
  decodeSourceContent,
  importCompileResult,
  statementLedger,
  type SpiceCompileOptions,
  type SpiceCompileResult,
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
   * name, as the caller states them, in its own order of precedence. A
   * native card's type comes after, and a card the sources give decides. */
  modelTypes?: Readonly<Record<string, string>>;
  /** The caller takes device types itself (an Agent's delivery), so a
   * finding on a model of unknown type asks for one. */
  givesModelTypes?: boolean;
  namingProfile?: SpiceImportOptions["namingProfile"];
  compileOptions?: SpiceCompileOptions;
  /** Another reading of the same files (an RNL drawing). */
  externalSubcircuitNames?: readonly string[];
  externalSubcircuitCalls?: readonly string[];
  externalSymbolMappings?: SpiceImportOptions["externalSymbolMappings"];
  calledBlocks?: SpiceImportOptions["calledBlocks"];
  libraryBodies?: SpiceImportOptions["libraryBodies"];
}

export type NetlistSourceImport = (
  | { status: "imported"; project: CircuitProject }
  | { status: "refused" }
) & {
  diagnostics: SpiceDiagnostic[];
  /** Every statement of the files the entry reaches, with its fate. */
  ledger: StatementLedger;
  /** Models the sources declare, as cards or native cards. */
  declaredModelNames: string[];
};

export interface CompiledNetlistSources {
  compiled: SpiceCompileResult | null;
  prepared: ReturnType<typeof prepareImportSources> | null;
  diagnostics: SpiceDiagnostic[];
  ledger: StatementLedger;
}

const EMPTY_LEDGER: StatementLedger = { entries: [], complete: false };

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

/** What the ledger counts: each fate, and where a statement went
 * unresolved or was refused. */
export function ledgerSummary(ledger: StatementLedger): string {
  const order: StatementFateKind[] = [
    "instance",
    "definition",
    "declaration",
    "preserved",
    "unresolved",
    "refused",
  ];
  const parts = order.flatMap((fate) => {
    const entries = ledger.entries.filter((entry) => entry.fate === fate);
    if (!entries.length) return [];
    const where =
      fate === "unresolved" || fate === "refused"
        ? ` (${entries
            .slice(0, 20)
            .map(({ path, line }) => `${path}:${line}`)
            .join(", ")}${entries.length > 20 ? `, and ${entries.length - 20} more` : ""})`
        : "";
    return [`${entries.length} ${fate}${where}`];
  });
  const unknown = ledger.entries.filter(({ fate }) => fate === "unknown");
  return `${ledger.entries.length} statements: ${parts.join(", ")}${
    unknown.length
      ? `; coverage unknown for ${unknown.length} (${unknown
          .slice(0, 20)
          .map(({ path, line }) => `${path}:${line}`)
          .join(", ")})`
      : ""
  }`;
}

/** The ledger as one finding, a warning where coverage is unknown. */
function coverageDiagnostic(ledger: StatementLedger): SpiceDiagnostic {
  return {
    code: "SPICE_IMPORT_COVERAGE",
    severity: ledger.complete ? "info" : "warning",
    stage: "import",
    message: ledgerSummary(ledger),
  };
}

/**
 * Prepare (convert native Spectre) and compile, as every entry does: the
 * review's reference stops here.
 */
export async function compileNetlistSources(
  inputs: readonly SpiceSourceInput[],
  entryPath: string,
  policy: NetlistImportPolicy = {},
): Promise<CompiledNetlistSources> {
  let prepared: ReturnType<typeof prepareImportSources>;
  try {
    prepared = prepareImportSources(
      inputs,
      policy.externalSubcircuitNames,
      policy.externalSubcircuitCalls,
    );
  } catch (error) {
    return {
      compiled: null,
      prepared: null,
      diagnostics: [
        {
          code: "SPICE_CONVERSION_BLOCKED",
          severity: "error",
          stage: "import",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      ledger: EMPTY_LEDGER,
    };
  }
  const compiled = await compileSpiceSources(
    prepared.inputs,
    entryPath,
    policy.compileOptions ?? {},
  );
  return {
    compiled,
    prepared,
    diagnostics: [...prepared.diagnostics, ...compiled.diagnostics],
    ledger: sourceLedger(
      statementLedger(compiled),
      compiled.bundle.files.map(({ path }) => path),
      inputs,
      prepared,
    ),
  };
}

export async function importNetlistSources(
  inputs: readonly SpiceSourceInput[],
  entryPath: string,
  policy: NetlistImportPolicy = {},
): Promise<NetlistSourceImport> {
  const { compiled, prepared, diagnostics: refusals } =
    await compileNetlistSources(inputs, entryPath, policy);
  if (!compiled || !prepared)
    return {
      status: "refused",
      diagnostics: refusals,
      ledger: EMPTY_LEDGER,
      declaredModelNames: [],
    };
  const result = importCompileResult(compiled, {
    originalSources: inputs,
    builtInBodies: prepared.builtInBodies,
    modelTypes: new Map([
      ...Object.entries(policy.modelTypes ?? {}),
      ...prepared.modelTypes,
    ]),
    declaredModelNames: [...prepared.modelTypes.keys()],
    ...(policy.namingProfile ? { namingProfile: policy.namingProfile } : {}),
    ...(policy.givesModelTypes ? { undeclaredModels: "give-type" } : {}),
    ...(policy.externalSymbolMappings
      ? { externalSymbolMappings: policy.externalSymbolMappings }
      : {}),
    ...(policy.calledBlocks ? { calledBlocks: policy.calledBlocks } : {}),
    ...(policy.libraryBodies ? { libraryBodies: policy.libraryBodies } : {}),
  });
  const ledger = sourceLedger(
    statementLedger(compiled, result),
    compiled.bundle.files.map(({ path }) => path),
    inputs,
    prepared,
  );
  const diagnostics = [
    ...prepared.diagnostics,
    ...result.diagnostics,
    coverageDiagnostic(ledger),
  ];
  const declaredModelNames = [
    ...(compiled.ir?.models.map(({ name }) => name) ?? []),
    ...prepared.modelTypes.keys(),
  ];
  return result.successful && result.project
    ? {
        status: "imported",
        project: result.project,
        diagnostics,
        ledger,
        declaredModelNames,
      }
    : { status: "refused", diagnostics, ledger, declaredModelNames };
}
