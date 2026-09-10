import type { SimulationSourceInput, SourceSpan } from "@icm/model";
import {
  inspectSimulationSource,
  resolveSimulationInclude,
  type SpiceDiagnostic,
  type SpiceStatement,
} from "@icm/spice";

export interface SimulationSourceDiagnostic extends Omit<
  SpiceDiagnostic,
  "stage"
> {
  path?: string;
  field?: string;
}
export interface SourceStatement {
  path: string;
  statement: SpiceStatement;
}
export interface SimulationSourceGraph {
  statements: SourceStatement[];
  /** Repeated includes remain repeated here; they are not silently suppressed. */
  paths: string[];
  diagnostics: SimulationSourceDiagnostic[];
}

/** Inspect the virtual include graph without rewriting, reading host files or executing control commands. */
export function inspectSimulationSourceGraph(
  input: SimulationSourceInput,
): SimulationSourceGraph {
  const files = new Map(input.files.map((file) => [file.path, file]));
  const generated = new Set(
    input.circuitBindings.map((binding) => binding.path),
  );
  const dependencies = new Set(input.dependencies.map((dep) => dep.mountPath));
  const result: SimulationSourceGraph = {
    statements: [],
    paths: [],
    diagnostics: [],
  };
  const cache = new Map<string, ReturnType<typeof inspectSimulationSource>>();
  const diagnosed = new Set<string>();
  let visits = 0;
  function fail(
    code: string,
    message: string,
    path: string,
    sourceRef?: SourceSpan,
  ) {
    result.diagnostics.push({
      code,
      severity: "error",
      message,
      path,
      ...(sourceRef ? { sourceRef } : {}),
    });
  }
  function visit(
    path: string,
    section: string | undefined,
    stack: string[],
    from?: SourceSpan,
  ) {
    const identity = JSON.stringify([path, section?.toLowerCase()]);
    if (stack.includes(identity)) {
      fail("SIMULATION_INCLUDE_CYCLE", `Include cycle at ${path}`, path, from);
      return;
    }
    if (stack.length >= 64 || ++visits > 16384) {
      fail(
        "SIMULATION_INCLUDE_LIMIT",
        "Include expansion exceeds the bounded inspection limit",
        path,
        from,
      );
      return;
    }
    result.paths.push(path);
    if (generated.has(path) || dependencies.has(path)) return;
    const file = files.get(path);
    if (!file) {
      fail(
        "SIMULATION_FILE_MISSING",
        `Included file does not exist: ${path}`,
        path,
        from,
      );
      return;
    }
    let parsed = cache.get(path);
    if (!parsed) {
      parsed = inspectSimulationSource(
        { ...file, id: path, hash: "", encoding: "utf-8" },
        path === input.entry,
      );
      cache.set(path, parsed);
    }
    const sections: string[] = [];
    const activeOffsets = new Set<number>();
    let found = section === undefined;
    for (const statement of parsed.statements) {
      if (statement.kind === "library" && statement.mode === "section-start") {
        sections.push(statement.section.toLowerCase());
        if (sections.at(-1) === section?.toLowerCase()) found = true;
        continue;
      }
      if (statement.kind === "library" && statement.mode === "section-end") {
        sections.pop();
        continue;
      }
      // A selected .lib section does not execute statements from other sections.
      if (section !== undefined && !sections.includes(section.toLowerCase()))
        continue;
      if (section === undefined && sections.length > 0) continue;
      activeOffsets.add(statement.sourceRef.start.offset);
      result.statements.push({ path, statement });
      if (
        statement.kind === "include" ||
        (statement.kind === "library" && statement.mode === "include")
      ) {
        const requested = statement.requestedPath;
        const resolved = requested
          ? resolveSimulationInclude(path, requested)
          : null;
        if (!resolved) {
          fail(
            "SIMULATION_INCLUDE_PATH",
            "Include must resolve within the virtual source root",
            path,
            statement.sourceRef,
          );
          continue;
        }
        if (resolved === input.configPath) {
          fail(
            "SIMULATION_INCLUDE_CONFIG",
            "experiment.json is configuration, not a SPICE include",
            path,
            statement.sourceRef,
          );
          continue;
        }
        visit(
          resolved,
          statement.kind === "library" ? statement.section : undefined,
          [...stack, identity],
          statement.sourceRef,
        );
      }
    }
    if (!diagnosed.has(identity)) {
      diagnosed.add(identity);
      result.diagnostics.push(
        ...parsed.diagnostics
          .filter(
            (item) =>
              !item.sourceRef || activeOffsets.has(item.sourceRef.start.offset),
          )
          .map(({ stage: _stage, ...item }) => ({ ...item, path })),
      );
    }
    if (!found)
      fail(
        "SIMULATION_LIBRARY_SECTION_MISSING",
        `No library section ${section} in ${path}`,
        path,
        from,
      );
  }
  visit(input.entry, undefined, []);
  return result;
}
