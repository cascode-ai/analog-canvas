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
  type ImportEvidence,
  type NativeStatementLine,
} from "./convert-import-sources";

/**
 * How one caller reads netlist sources: the evidence it holds beyond the
 * files themselves. Every entry (File / Open, an Agent's local circuit, a
 * review's reference, RNL) reads through the same import; they differ only
 * in the evidence they bring.
 */
export interface NetlistImportPolicy extends ImportEvidence {
  namingProfile?: SpiceImportOptions["namingProfile"];
  compileOptions?: SpiceCompileOptions;
  /** Another reading of the same files (an RNL drawing). */
  externalSymbolMappings?: SpiceImportOptions["externalSymbolMappings"];
  calledBlocks?: SpiceImportOptions["calledBlocks"];
  libraryBodies?: SpiceImportOptions["libraryBodies"];
}

export type NetlistSourceImport = (
  { status: "imported"; project: CircuitProject } | { status: "refused" }
) &
  CompiledNetlistSources & {
    /** Models the sources declare, as cards or native cards. */
    declaredModelNames: string[];
  };

export interface CompiledNetlistSources {
  compiled: SpiceCompileResult | null;
  prepared: ReturnType<typeof prepareImportSources> | null;
  diagnostics: SpiceDiagnostic[];
  /** Every statement of the files the entry reaches, with its fate. */
  ledger: StatementLedger;
}

/**
 * A design the conversion refused: each refused statement where it is. The
 * rest went unread, so coverage is not complete.
 */
function refusedLedger(
  refused: readonly { path: string; line: number; reason: string }[],
): StatementLedger {
  return {
    entries: refused.map(({ path, line, reason }) => ({
      path,
      line,
      endLine: line,
      fate: "refused",
      reason,
      text: "",
    })),
    complete: false,
  };
}

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
  "outside the drawing": ["preserved", "outside the drawing, not converted"],
  dependency: ["declaration", "Verilog-A dependency, not converted"],
  "library structure": ["declaration", "library structure"],
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
        {
          ...entry,
          path: origin.path,
          line: origin.line,
          endLine: origin.line,
        },
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

const LEDGER_LOCATION_LIMIT = 20;

/** Statement counts and a bounded preview of unresolved and refused locations. */
export function ledgerCoverage(ledger: StatementLedger, locationLimit: number) {
  const counts = {
    instance: 0,
    definition: 0,
    declaration: 0,
    preserved: 0,
    unresolved: 0,
    refused: 0,
    unknown: 0,
  };
  type Location = Pick<StatementLedgerEntry, "path" | "line">;
  const unresolved: Location[] = [];
  const refused: Location[] = [];
  for (const { path, line, fate } of ledger.entries) {
    counts[fate] += 1;
    if (fate === "unresolved" && unresolved.length < locationLimit)
      unresolved.push({ path, line });
    if (fate === "refused" && refused.length < locationLimit)
      refused.push({ path, line });
  }
  return {
    total: ledger.entries.length,
    complete: ledger.complete,
    counts,
    unresolved,
    refused,
  };
}

/** What the ledger counts: each fate, and where a statement went
 * unresolved or was refused. */
export function ledgerSummary(
  ledger: StatementLedger,
  locationLimit = LEDGER_LOCATION_LIMIT,
): string {
  const { total, counts, unresolved, refused } = ledgerCoverage(
    ledger,
    locationLimit,
  );
  const locations = { unresolved, refused };
  const order: StatementFateKind[] = [
    "instance",
    "definition",
    "declaration",
    "preserved",
    "unresolved",
    "refused",
  ];
  const parts = order.flatMap((fate) => {
    const count = counts[fate];
    if (!count) return [];
    const where =
      fate === "unresolved" || fate === "refused"
        ? ` (${locations[fate]
            .map(({ path, line }) => `${path}:${line}`)
            .join(
              ", ",
            )}${count > locationLimit ? `, and ${count - locationLimit} more` : ""})`
        : "";
    return [`${count} ${fate}${where}`];
  });
  return `${total} statements: ${parts.join(", ")}${
    counts.unknown
      ? `; coverage unknown for ${counts.unknown} (${ledger.entries
          .filter(({ fate }) => fate === "unknown")
          .slice(0, locationLimit)
          .map(({ path, line }) => `${path}:${line}`)
          .join(", ")})`
      : ""
  }`;
}

/** What the ledger counts in each Cell: its statements, and how many of
 * them went unresolved or were refused. */
export function ledgerByCell(ledger: StatementLedger): string {
  const cells = new Map<string, StatementLedgerEntry[]>();
  for (const entry of ledger.entries) {
    const cell = entry.cell ?? "file level";
    cells.set(cell, [...(cells.get(cell) ?? []), entry]);
  }
  return [...cells]
    .map(([cell, entries]) => {
      const open = (["unresolved", "refused", "unknown"] as const)
        .map(
          (fate) =>
            [fate, entries.filter((e) => e.fate === fate).length] as const,
        )
        .filter(([, count]) => count)
        .map(([fate, count]) => `${count} ${fate}`);
      return `${cell} ${entries.length}${open.length ? ` (${open.join(", ")})` : ""}`;
    })
    .join(", ");
}

/** The ledger as one finding, a warning where coverage is unknown. */
function coverageDiagnostic(ledger: StatementLedger): SpiceDiagnostic {
  return {
    code: "SPICE_IMPORT_COVERAGE",
    // A statement unresolved, refused or unaccounted is worth attention
    // (an Agent receives warnings, not information).
    severity: ledger.entries.some(({ fate }) =>
      ["unresolved", "refused", "unknown"].includes(fate),
    )
      ? "warning"
      : "info",
    stage: "import",
    message: ledgerSummary(ledger),
  };
}

/**
 * Prepare (convert native Spectre) and compile. The review compares this
 * circuit IR and reports the ledger after import has accounted for it.
 */
export async function compileNetlistSources(
  inputs: readonly SpiceSourceInput[],
  entryPath: string,
  policy: NetlistImportPolicy = {},
): Promise<CompiledNetlistSources> {
  const prepared = prepareImportSources(inputs, policy);
  if (prepared.refusals.length)
    return {
      compiled: null,
      prepared: null,
      diagnostics: [...prepared.refusals, ...prepared.diagnostics],
      ledger: refusedLedger(prepared.refusedStatements),
    };
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
  const source = await compileNetlistSources(inputs, entryPath, policy);
  const { compiled, prepared } = source;
  if (!compiled || !prepared)
    return {
      ...source,
      status: "refused",
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
    callReferences: prepared.callReferences,
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
  const read = { compiled, prepared, diagnostics, ledger, declaredModelNames };
  return result.successful && result.project
    ? { ...read, status: "imported", project: result.project }
    : { ...read, status: "refused" };
}
