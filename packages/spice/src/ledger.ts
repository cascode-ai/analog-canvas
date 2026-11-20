import {
  deriveStableId,
  type CircuitProject,
  type SourceSpan,
} from "@icm/model";

import type { SpiceCompileResult } from "./compiler.js";
import type { SpiceDiagnostic } from "./diagnostics.js";

/**
 * Where a source statement went (#2294): every non-comment logical
 * statement of a reachable file has exactly one.
 *
 * - `instance`: a device or call that became an Instance (or a coupling).
 * - `definition`: a subcircuit's header and end, or a statement inside a
 *   library or built-in body that imports as no Cell.
 * - `declaration`: model, parameter, global, function, include or library.
 * - `preserved`: recognized but outside the drawing: title, analyses,
 *   options, control, a branch not taken, a section not selected.
 * - `unresolved`: unparsed, or not decidable: a condition not evaluated
 *   and its branches, a coupling the import skipped.
 * - `refused`: an error stopped it.
 */
export type StatementFateKind =
  | "instance"
  | "definition"
  | "declaration"
  | "preserved"
  | "unresolved"
  | "refused";

/** What the compiler decided for one statement. */
export interface StatementFate {
  sourceRef: SourceSpan;
  fate: StatementFateKind;
  reason?: string;
  /** The subcircuit the statement sits in; none at file level. */
  cell?: string;
}

export interface StatementLedgerEntry {
  path: string;
  line: number;
  endLine: number;
  /** `unknown` only where the accounting itself has a gap. */
  fate: StatementFateKind | "unknown";
  reason?: string;
  code?: string;
  cell?: string;
  text: string;
}

export interface StatementLedger {
  entries: StatementLedgerEntry[];
  /** No statement without a fate: otherwise coverage is unknown, never complete. */
  complete: boolean;
}

const key = (span: SourceSpan) => `${span.fileId}:${span.start.offset}`;

/**
 * Every statement of the compiled files with its fate: the compiler's,
 * then what the import made of each device or call, then any error that
 * stopped one.
 */
export function statementLedger(
  compiled: SpiceCompileResult,
  imported?: {
    project: CircuitProject | null;
    diagnostics: readonly SpiceDiagnostic[];
  },
): StatementLedger {
  const decided = new Map(
    (compiled.statementFates ?? []).map((fate) => [key(fate.sourceRef), fate]),
  );
  const project = imported?.project ?? null;
  const placed = new Set(
    (project?.documents ?? []).flatMap((document) =>
      document.instances.flatMap((instance) =>
        instance.sourceRef ? [key(instance.sourceRef)] : [],
      ),
    ),
  );
  const documents = new Set(project?.documents.map(({ id }) => id));
  const diagnosed = new Map<string, SpiceDiagnostic>();
  for (const item of [
    ...compiled.diagnostics,
    ...(imported?.diagnostics ?? []),
  ])
    if (item.sourceRef && !diagnosed.has(key(item.sourceRef)))
      diagnosed.set(key(item.sourceRef), item);
  const paths = new Map(compiled.bundle.files.map(({ id, path }) => [id, path]));
  const entries: StatementLedgerEntry[] = [];
  for (const syntax of compiled.bundle.syntaxFiles)
    for (const statement of syntax.statements) {
      const at = key(statement.sourceRef);
      const base = decided.get(at);
      const diagnostic = diagnosed.get(at);
      let fate: StatementLedgerEntry["fate"] = base?.fate ?? "unknown";
      let reason = base?.reason;
      if (fate === "instance" && project && !placed.has(at)) {
        const document = deriveStableId(
          "document",
          (base?.cell ?? "__flat__").toLowerCase(),
        );
        if (diagnostic?.code === "SPICE_IMPORT_NON_VISUAL_INSTANCE") {
          fate = "preserved";
          reason = "no electrical terminals";
        } else if (diagnostic?.code === "SPICE_IMPORT_COUPLING_SKIPPED") {
          fate = "unresolved";
          reason = "coupling skipped";
        } else if (
          statement.kind === "instance" &&
          statement.family === "mutual-inductor"
        )
          reason = "coupling";
        else if (!documents.has(document)) {
          fate = "definition";
          reason = "inside a library or built-in body";
        } else if (diagnostic?.severity !== "error") fate = "unknown";
      }
      if (diagnostic?.severity === "error") {
        fate = "refused";
        reason = diagnostic.message;
      }
      entries.push({
        path: paths.get(statement.sourceRef.fileId) ?? statement.sourceRef.fileId,
        line: statement.sourceRef.start.line,
        endLine: statement.sourceRef.end.line,
        fate,
        ...(reason ? { reason } : {}),
        ...(diagnostic?.severity === "error" ? { code: diagnostic.code } : {}),
        ...(base?.cell ? { cell: base.cell } : {}),
        text: statement.rawText.split(/\r?\n/u)[0]!.trim().slice(0, 160),
      });
    }
  return {
    entries,
    complete: entries.every((entry) => entry.fate !== "unknown"),
  };
}
