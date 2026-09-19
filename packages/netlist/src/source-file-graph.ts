import {
  resolveSimulationInputPath,
  type SimulationSourceInput,
  type SourceSpan,
  type ObjectLocator,
} from "@icm/model";

export interface SimulationSourceDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  sourceRef?: SourceSpan;
  related?: { message: string; sourceRef: SourceSpan }[];
  path?: string;
  field?: string;
  primary?: Omit<ObjectLocator, "hierarchyPath"> & {
    hierarchyPath: ObjectLocator["hierarchyPath"][number][];
  };
}
export interface InspectedSourceItem<T> {
  statement: T;
  sourceRef: SourceSpan;
  include?: { requestedPath: string; section?: string };
  section?: { kind: "start" | "end"; name: string };
}
export interface SourceFileGraph<T> {
  statements: { path: string; statement: T }[];
  includes: {
    path: string;
    target: string;
    section?: string;
    sourceRef: SourceSpan;
  }[];
  /** Repeated includes remain repeated, in execution order. */
  paths: string[];
  diagnostics: SimulationSourceDiagnostic[];
}

/** One virtual-file ownership/expansion boundary. Syntax adapters supply events;
 * this traversal neither rewrites source nor reads the host filesystem. */
export function inspectSourceFileGraph<T>(
  input: SimulationSourceInput,
  inspect: (
    path: string,
    text: string,
    entry: boolean,
  ) => {
    items: InspectedSourceItem<T>[];
    diagnostics: SimulationSourceDiagnostic[];
  },
  options: {
    sectionKey: (name: string) => string;
    rootFallback?: boolean;
    flatSections?: boolean;
  },
): SourceFileGraph<T> {
  const files = new Map(input.files.map((file) => [file.path, file]));
  const opaque = new Set([
    ...input.circuitBindings.map((binding) => binding.path),
    ...input.dependencies.map((dependency) => dependency.mountPath),
  ]);
  const result: SourceFileGraph<T> = {
    statements: [],
    includes: [],
    paths: [],
    diagnostics: [],
  };
  const cache = new Map<string, ReturnType<typeof inspect>>();
  const diagnosed = new Set<string>();
  let visits = 0;
  const fail = (
    code: string,
    message: string,
    path: string,
    sourceRef?: SourceSpan,
  ) =>
    result.diagnostics.push({
      code,
      message,
      severity: "error",
      path,
      ...(sourceRef ? { sourceRef } : {}),
    });
  function visit(
    path: string,
    section: string | undefined,
    stack: string[],
    from?: SourceSpan,
  ) {
    const selected =
      section === undefined ? undefined : options.sectionKey(section);
    const identity = JSON.stringify([path, selected]);
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
    if (opaque.has(path)) return;
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
      parsed = inspect(path, file.text, path === input.entry);
      cache.set(path, parsed);
    }
    const sections: string[] = [];
    const activeOffsets = new Set<number>();
    let found = section === undefined;
    let sectionClosed = false;
    let sectionInvalid = false;
    for (const item of parsed.items) {
      if (item.section?.kind === "start") {
        if (options.flatSections) {
          if (selected === undefined || sections.length) {
            fail(
              "SIMULATION_LIBRARY_SECTION_INVALID",
              "Unexpected section: use a section-selected include; sections cannot nest",
              path,
              item.sourceRef,
            );
            sectionInvalid = true;
            break;
          }
          if (options.sectionKey(item.section.name) !== selected) continue;
        }
        sections.push(options.sectionKey(item.section.name));
        if (sections.at(-1) === selected) found = true;
        continue;
      }
      if (item.section?.kind === "end") {
        if (options.flatSections) {
          if (selected === undefined) {
            fail(
              "SIMULATION_LIBRARY_SECTION_INVALID",
              "endsection requires a section-selected include",
              path,
              item.sourceRef,
            );
            sectionInvalid = true;
            break;
          }
          if (found) {
            sectionClosed = true;
            break;
          }
        }
        sections.pop();
        continue;
      }
      if (selected !== undefined && !sections.includes(selected)) continue;
      if (selected === undefined && sections.length) continue;
      activeOffsets.add(item.sourceRef.start.offset);
      result.statements.push({ path, statement: item.statement });
      if (!item.include) continue;
      const ownerRelative = resolveSimulationInputPath(
        path,
        item.include.requestedPath,
      );
      if (!ownerRelative) {
        fail(
          "SIMULATION_INCLUDE_PATH",
          "Include must resolve within the virtual source root",
          path,
          item.sourceRef,
        );
        continue;
      }
      const rootRelative = options.rootFallback
        ? resolveSimulationInputPath("entry", item.include.requestedPath)
        : null;
      const resolved =
        files.has(ownerRelative) ||
        opaque.has(ownerRelative) ||
        !rootRelative ||
        (!files.has(rootRelative) && !opaque.has(rootRelative))
          ? ownerRelative
          : rootRelative;
      if (resolved === input.configPath) {
        fail(
          "SIMULATION_INCLUDE_CONFIG",
          "The experiment configuration is not a circuit source include",
          path,
          item.sourceRef,
        );
        continue;
      }
      result.includes.push({
        path,
        target: resolved,
        sourceRef: item.sourceRef,
        ...(item.include.section === undefined
          ? {}
          : { section: item.include.section }),
      });
      visit(
        resolved,
        item.include.section,
        [...stack, identity],
        item.sourceRef,
      );
    }
    if (!diagnosed.has(identity)) {
      diagnosed.add(identity);
      result.diagnostics.push(
        ...parsed.diagnostics
          .filter(
            (item) =>
              !item.sourceRef || activeOffsets.has(item.sourceRef.start.offset),
          )
          .map((item) => ({ ...item, path })),
      );
    }
    if (!found)
      fail(
        "SIMULATION_LIBRARY_SECTION_MISSING",
        `No library section ${section} in ${path}`,
        path,
        from,
      );
    else if (
      options.flatSections &&
      selected !== undefined &&
      !sectionClosed &&
      !sectionInvalid
    )
      fail(
        "SIMULATION_LIBRARY_SECTION_INVALID",
        `Unterminated section ${section} in ${path}`,
        path,
        from,
      );
  }
  visit(input.entry, undefined, []);
  return result;
}
