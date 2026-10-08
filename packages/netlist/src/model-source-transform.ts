import type { ProjectModelSource } from "@icm/model";
import { convertNetlist } from "@icm/spice";
import {
  inspectProjectModelSource,
  modelSourceLibraryDialectDiagnostic,
  projectModelConversionDiagnostic,
} from "./project-model-source.js";
import type { SimulationSourceDiagnostic } from "./source-file-graph.js";
import {
  inspectSpiceModelProcess,
  replaceSpiceModelProcess,
  type ModelSourceProcess,
} from "./model-source-process.js";

/** GUI draft shortcuts and Agent Apply use this same bounded native operation. */
export function transformProjectModelSource(
  source: ProjectModelSource,
  target: {
    language?: ProjectModelSource["language"] | undefined;
    process?: ModelSourceProcess | undefined;
  },
):
  | { ok: true; source: ProjectModelSource }
  | { ok: false; diagnostic: SimulationSourceDiagnostic } {
  const next = structuredClone(source);
  const inspected = inspectProjectModelSource(source);
  const invalid = inspected.diagnostics.find((d) => d.severity === "error");
  if (invalid) return { ok: false, diagnostic: invalid };
  const outputLanguage = target.language ?? source.language;
  if (target.process) {
    const canonical = transformProjectModelSource(source, {
      language: "spice",
    });
    if (!canonical.ok) return canonical;
    const mapped = replaceSpiceModelProcess(canonical.source, target.process);
    if (!mapped.ok) return mapped;
    return transformProjectModelSource(mapped.source, {
      language: outputLanguage,
    });
  }
  if (outputLanguage === source.language) return { ok: true, source: next };
  const libraryFailure = modelSourceLibraryDialectDiagnostic(
    source,
    outputLanguage,
  );
  if (libraryFailure) return { ok: false, diagnostic: libraryFailure };
  for (const file of next.files) {
    const ownedIncludes = inspected.graph.includes
      .filter(
        (i) =>
          i.path === file.path && source.files.some((f) => f.path === i.target),
      )
      .map((i) => {
        const statement = inspected.graph.statements.find(
          (s) =>
            s.path === file.path &&
            s.statement.sourceRef.start.offset === i.sourceRef.start.offset,
        )!.statement;
        return statement.kind === "include" || statement.kind === "library"
          ? statement.requestedPath!.replace(/^"|"$/g, "")
          : "";
      });
    const converted = convertNetlist({
      text: file.text,
      source: source.language,
      target: outputLanguage,
      fragment: true,
      ownedIncludes,
      subcircuitNames: inspected.entries.map((e) => e.name),
    });
    if (converted.status === "blocked") {
      const issue = converted.issues[0]!;
      const offset = file.text
        .split("\n")
        .slice(0, issue.line - 1)
        .reduce((sum, line) => sum + line.length + 1, 0);
      return {
        ok: false,
        diagnostic: {
          code: issue.code,
          severity: "error",
          message: issue.message,
          path: file.path,
          sourceRef: {
            fileId: file.path,
            start: { line: issue.line, column: 1, offset },
            end: { line: issue.line, column: 1, offset },
          },
        },
      };
    }
    file.text = converted.text;
  }
  // Per-file validation preserves native refusal codes. Also validate the
  // complete closure: a helper may own the parameters referenced by its caller.
  const closureFailure = projectModelConversionDiagnostic(
    source,
    outputLanguage,
  );
  if (closureFailure) return { ok: false, diagnostic: closureFailure };
  next.language = outputLanguage;
  const failure = inspectProjectModelSource(next).diagnostics.find(
    (d) => d.severity === "error",
  );
  return failure
    ? { ok: false, diagnostic: failure }
    : { ok: true, source: next };
}

/** Process is a projection of real owned calls and dependencies, not a label. */
export function inspectProjectModelProcess(
  source: ProjectModelSource,
): ModelSourceProcess {
  const canonical = transformProjectModelSource(source, { language: "spice" });
  return canonical.ok ? inspectSpiceModelProcess(canonical.source) : "custom";
}
