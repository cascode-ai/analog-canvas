import type {
  CircuitProject,
  ProjectModelSource,
  ExternalSubcircuitDefinition,
} from "@icm/model";
import {
  type SubcircuitStartStatement,
  type ModelStatement,
  convertNetlist,
} from "@icm/spice";
import {
  inspectModelSourceGraph,
  inspectModelSourceFile,
  modelSourceSectionKey,
} from "./model-source-syntax.js";
import type { SimulationSourceDiagnostic } from "./source-file-graph.js";
import { resolveReviewedLibraryInterface } from "@icm/devices";
import { projectVacaskModel } from "./vacask-project-model.js";
import { inspectVacaskSource } from "./vacask-source.js";

/** Native inspection retains opaque bodies; acceptance is not simulator qualification. */
export function inspectProjectModelSource(source: ProjectModelSource) {
  const graph = inspectModelSourceGraph(source);
  const diagnostics = [...graph.diagnostics];
  type NativeEntry = SubcircuitStartStatement & {
    sourceLanguage?: ProjectModelSource["language"];
  };
  const entries: NativeEntry[] = [];
  const names = new Set<string>();
  const globalModels: (ModelStatement & {
    sourceLanguage?: ProjectModelSource["language"];
  })[] = [];
  const deviceModelNames = new Set<string>();
  let current: NativeEntry | undefined;
  const key = (name: string, language = source.language) =>
    language === "spectre" ? name : name.toLowerCase();
  for (const { path, statement } of graph.statements) {
    const fail = (message: string) =>
      diagnostics.push({
        code: "MODEL_SOURCE_DECLARATION",
        severity: "error",
        message,
        path,
        sourceRef: statement.sourceRef,
      });
    if (statement.kind === "subckt_start") {
      if (current)
        fail("Nested model subcircuit declarations are not supported");
      if (names.has(key(statement.name, statement.sourceLanguage)))
        fail(`Duplicate model definition ${statement.name}`);
      names.add(key(statement.name, statement.sourceLanguage));
      current = statement;
      entries.push(statement);
      if (
        new Set(statement.ports.map((p) => key(p, statement.sourceLanguage)))
          .size !== statement.ports.length
      )
        fail("Model terminal names must be unique");
      if (
        new Set(
          statement.parameters.map((p) =>
            key(p.name, statement.sourceLanguage),
          ),
        ).size !== statement.parameters.length
      )
        fail("Model formal parameter names must be unique");
    } else if (statement.kind === "subckt_end") {
      if (
        !current ||
        (statement.name &&
          key(statement.name, statement.sourceLanguage) !==
            key(current.name, current.sourceLanguage))
      )
        fail("Model .ends does not match its declaration");
      current = undefined;
    } else if (
      statement.kind === "parameter" &&
      source.language === "spectre" &&
      statement.sourceLanguage !== "spice" &&
      current
    ) {
      current.parameters.push(...statement.parameters);
    } else if (statement.kind === "model") {
      const identity = JSON.stringify([
        current ? key(current.name, current.sourceLanguage) : undefined,
        key(statement.name, statement.sourceLanguage),
      ]);
      if (deviceModelNames.has(identity))
        fail(`Duplicate device model ${statement.name}`);
      deviceModelNames.add(identity);
      if (!current) globalModels.push(statement);
    } else if (
      statement.kind === "control_command" ||
      statement.kind === "control_boundary"
    ) {
      fail(
        "Model sources contain definitions, not experiment control commands",
      );
    } else if (
      statement.kind === "directive" &&
      (statement.category === "analysis" ||
        statement.category === "output" ||
        ["end", "title"].includes(statement.name.toLowerCase()))
    ) {
      fail(
        "Model sources cannot contain experiment analyses, outputs or deck boundaries",
      );
    }
  }
  if (current)
    diagnostics.push({
      code: "MODEL_SOURCE_DECLARATION",
      severity: "error",
      message: `Missing .ends for ${current.name}`,
      sourceRef: current.sourceRef,
    });
  for (const entry of entries)
    if (
      new Set(entry.parameters.map((p) => key(p.name, entry.sourceLanguage)))
        .size !== entry.parameters.length
    )
      diagnostics.push({
        code: "MODEL_SOURCE_DECLARATION",
        severity: "error",
        message: "Model parameter names must be unique",
        path: entry.sourceRef.fileId,
        sourceRef: entry.sourceRef,
      });
  return { entries, globalModels, graph, diagnostics };
}

function modelInterfaceMatches(
  definition: ExternalSubcircuitDefinition,
  entry: SubcircuitStartStatement,
): boolean {
  return (
    definition.name === entry.name &&
    JSON.stringify(definition.terminals.map((t) => t.name)) ===
      JSON.stringify(entry.ports) &&
    JSON.stringify(definition.formalParameters) ===
      JSON.stringify(
        entry.parameters.map((p) => ({
          name: p.name,
          defaultValue: p.rawText,
        })),
      )
  );
}

/** Reachability follows the typed master bindings used by electrical extraction. */
export function projectModelDefinitionIds(
  project: CircuitProject,
  roots: readonly string[],
): string[] {
  return projectModelReachability(project, roots).definitionIds;
}

export function projectModelReachability(
  project: CircuitProject,
  roots: readonly string[],
) {
  const visited = new Set<string>();
  const definitions = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const document = project.documents.find((d) => d.id === id);
    for (const instance of document?.instances ?? []) {
      const binding = instance.netlist?.binding;
      if (binding?.kind === "subcircuit") visit(binding.childDocumentId);
      if (binding?.kind === "external-subcircuit")
        definitions.add(binding.definitionId);
    }
  };
  roots.forEach(visit);
  return { documentIds: [...visited], definitionIds: [...definitions] };
}

/** One source inventory for copying/export and execution, never folder-local overrides. */
export function collectProjectModelSources(
  project: CircuitProject,
  ids: readonly string[],
  options: {
    format?: string;
    requireImplementation?: boolean;
    reservedNames?: readonly string[];
  } = {},
) {
  const sources: ProjectModelSource[] = [];
  const diagnostics: SimulationSourceDiagnostic[] = [];
  const names = (options.reservedNames ?? []).map((name) => ({
    name,
    nativeSpectre: options.format === "spectre",
  }));
  const seen = new Set<string>();
  const deviceModelNames: { name: string; nativeSpectre: boolean }[] = [];
  for (const id of ids) {
    const definition = project.externalSubcircuitDefinitions.find(
      (d) => d.id === id,
    );
    const implementation = definition?.implementation;
    if (!definition) continue;
    if (!implementation) {
      if (
        !resolveReviewedLibraryInterface(
          definition.name,
          definition.terminals.map((t) => t.name),
        )
      )
        diagnostics.push({
          code: "MODEL_LEGACY_IMPLEMENTATION_UNVERIFIED",
          severity: "warning",
          message: `Legacy declaration ${definition.name} has no Project-owned implementation; resolve its source explicitly in Cell Manager`,
        });
      continue;
    }
    if (implementation.kind === "placeholder") {
      diagnostics.push({
        code: "MODEL_IMPLEMENTATION_MISSING",
        severity: options.requireImplementation ? "error" : "warning",
        message: `External model ${definition.name} is an unimplemented placeholder`,
      });
      continue;
    }
    const source = project.modelSources?.find(
      (s) => s.id === implementation.sourceId,
    );
    if (!source) {
      diagnostics.push({
        code: "MODEL_SOURCE_MISSING",
        severity: "error",
        message: `Missing model source for ${definition.name}`,
      });
      continue;
    }
    const inspected = inspectProjectModelSource(source);
    const modelSource = { sourceId: source.id, revision: source.revision };
    const entry = inspected.entries.find((e) =>
      source.language === "spectre"
        ? e.name === implementation.entry
        : e.name.toLowerCase() === implementation.entry.toLowerCase(),
    );
    if (!entry || !modelInterfaceMatches(definition, entry))
      diagnostics.push({
        code: "MODEL_INTERFACE_MISMATCH",
        severity: "error",
        message: `Interface of ${definition.name} differs from its authoritative model source`,
        path: entry?.sourceRef.fileId ?? source.entry,
        ...(entry ? { sourceRef: entry.sourceRef } : {}),
        modelSource,
      });
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    if (source.draft)
      diagnostics.push({
        code: "MODEL_SOURCE_DRAFT_PENDING",
        severity: "warning",
        message: `Model ${definition.name} has a saved draft; using applied version ${source.revision}`,
        path: source.entry,
        modelSource,
      });
    diagnostics.push(
      ...inspected.diagnostics.map((d) => ({
        ...d,
        modelSource,
      })),
    );
    if (
      options.format &&
      options.format !== source.language &&
      !inspected.diagnostics.some((d) => d.severity === "error")
    ) {
      const failure =
        options.format === "spice" ||
        options.format === "spectre" ||
        options.format === "vacask"
          ? projectModelConversionDiagnostic(source, options.format)
          : {
              code: "MODEL_SOURCE_DIALECT",
              severity: "error" as const,
              message: `Model ${definition.name} cannot be emitted as ${options.format}`,
              path: source.entry,
            };
      if (failure) diagnostics.push({ ...failure, modelSource });
    }
    for (const declared of inspected.entries) {
      const nativeSpectre =
        (declared.sourceLanguage ?? options.format ?? source.language) ===
        "spectre";
      if (
        names.some((previous) =>
          previous.nativeSpectre && nativeSpectre
            ? previous.name === declared.name
            : previous.name.toLowerCase() === declared.name.toLowerCase(),
        )
      )
        diagnostics.push({
          code: "MODEL_SOURCE_NAME_CONFLICT",
          severity: "error",
          message: `Model definition conflicts with ${declared.name}`,
          path: declared.sourceRef.fileId,
          sourceRef: declared.sourceRef,
          modelSource,
        });
      names.push({ name: declared.name, nativeSpectre });
    }
    for (const declared of inspected.globalModels) {
      const nativeSpectre =
        (declared.sourceLanguage ?? options.format ?? source.language) ===
        "spectre";
      if (
        deviceModelNames.some((previous) =>
          previous.nativeSpectre && nativeSpectre
            ? previous.name === declared.name
            : previous.name.toLowerCase() === declared.name.toLowerCase(),
        )
      )
        diagnostics.push({
          code: "MODEL_SOURCE_NAME_CONFLICT",
          severity: "error",
          message: `Global device model conflicts with ${declared.name}`,
          path: declared.sourceRef.fileId,
          sourceRef: declared.sourceRef,
          modelSource,
        });
      deviceModelNames.push({ name: declared.name, nativeSpectre });
    }
    sources.push(source);
  }
  return { sources, diagnostics };
}

export interface ProjectModelSourceLocation {
  sourceId: string;
  revision: number;
  path: string;
  startOffset: number;
  endOffset: number;
  sourceOffset: number;
  /** Converted spans navigate to the owner; they are not byte-reversible. */
  derived?: boolean;
  sourceLength?: number;
}

export interface PrintedProjectModelSource {
  text: string;
  segments: ProjectModelSourceLocation[];
}

/** An external native library is not translated by changing its include card. */
export function modelSourceLibraryDialectDiagnostic(
  source: ProjectModelSource,
  target: "spice" | "spectre",
): SimulationSourceDiagnostic | undefined {
  if (source.language !== "spectre" || target !== "spice") return;
  const inspected = inspectProjectModelSource(source);
  const native = inspected.graph.includes.find(
    (load) =>
      !source.files.some((f) => f.path === load.target) &&
      inspected.graph.statements.some(
        (s) =>
          s.path === load.path &&
          s.statement.sourceRef.start.offset === load.sourceRef.start.offset &&
          s.statement.sourceLanguage !== "spice",
      ),
  );
  if (native)
    return {
      code: "MODEL_SOURCE_LIBRARY_DIALECT",
      severity: "error",
      message:
        "The external library's native language cannot be qualified for SPICE; edit its real reference.",
      path: native.path,
      sourceRef: native.sourceRef,
    };
}

export function projectModelConversionDiagnostic(
  source: ProjectModelSource,
  target: "spice" | "spectre" | "vacask",
): SimulationSourceDiagnostic | undefined {
  if (target === "vacask") {
    if (source.language !== "spice") {
      const failure = projectModelConversionDiagnostic(source, "spice");
      if (failure) return failure;
    }
    const projected = projectVacaskModel(
      source,
      renderProjectModelSource(source, {
        format: "spice",
        conversionLocations: true,
      }),
      [],
      inspectProjectModelSource(source).entries,
    );
    return projected.ok ? undefined : projected.diagnostics[0];
  }
  const libraryFailure = modelSourceLibraryDialectDiagnostic(source, target);
  if (libraryFailure) return libraryFailure;
  const native = renderProjectModelSource(source);
  const converted = convertExpandedModelSource(source, native.text, target);
  if (converted.status !== "blocked") return;
  const issue = converted.issues[0]!;
  const offset = native.text
    .split("\n")
    .slice(0, issue.line - 1)
    .reduce((sum, line) => sum + line.length + 1, 0);
  const segment = native.segments.find(
    (s) => offset >= s.startOffset && offset < s.endOffset,
  );
  const path = segment?.path ?? source.entry;
  const sourceOffset = segment
    ? segment.sourceOffset + offset - segment.startOffset
    : 0;
  const before = source.files
    .find((f) => f.path === path)!
    .text.slice(0, sourceOffset)
    .split("\n");
  const point = {
    offset: sourceOffset,
    line: before.length,
    column: before.at(-1)!.length + 1,
  };
  return {
    code: "MODEL_SOURCE_DIALECT",
    severity: "error",
    message: issue.message,
    path,
    sourceRef: { fileId: path, start: point, end: point },
  };
}

function convertExpandedModelSource(
  source: ProjectModelSource,
  text: string,
  target: "spice" | "spectre",
  withLineOrigins = false,
) {
  return convertNetlist({
    text,
    source: source.language,
    target,
    fragment: true,
    withLineOrigins,
  });
}

/** Expand only owned include references; native body bytes and external loads survive. */
export function renderProjectModelSource(
  source: ProjectModelSource,
  options: {
    outputPath?: string;
    format?: "spice" | "spectre" | "vacask";
    reservedNames?: Iterable<string>;
    conversionLocations?: boolean;
  } = {},
): PrintedProjectModelSource {
  if (options.format === "vacask") {
    const projected = projectVacaskModel(
      source,
      renderProjectModelSource(source, {
        ...options,
        format: "spice",
        conversionLocations: true,
      }),
      options.reservedNames,
      inspectProjectModelSource(source).entries,
    );
    if (!projected.ok) throw Error(projected.diagnostics[0]!.message);
    return projected.rendered;
  }
  const inspected = inspectProjectModelSource(source);
  const result: PrintedProjectModelSource = { text: "", segments: [] };
  // Graph records are expanded visits. Rendering needs each lexical include
  // site once per visit, while retaining distinct authored include statements.
  const includes = [
    ...new Map(
      inspected.graph.includes.map((include) => [
        JSON.stringify([
          include.path,
          include.sourceRef.start.offset,
          include.sourceRef.end.offset,
        ]),
        include,
      ]),
    ).values(),
  ];
  const append = (path: string, text: string, sourceOffset: number) => {
    if (!text) return;
    const startOffset = result.text.length;
    result.text += text;
    result.segments.push({
      sourceId: source.id,
      revision: source.revision,
      path,
      startOffset,
      endOffset: result.text.length,
      sourceOffset,
    });
  };
  const emit = (
    path: string,
    section?: string,
    stack: string[] = [],
    callerLanguage?: ProjectModelSource["language"],
  ) => {
    const file = source.files.find((f) => f.path === path);
    if (!file) throw new Error(`Missing owned model file ${path}`);
    const sectionKey = (name: string) =>
      modelSourceSectionKey(source, path, name);
    const identity = JSON.stringify([path, section && sectionKey(section)]);
    if (stack.includes(identity))
      throw new Error(`Model include cycle at ${path}`);
    let start = 0;
    let end = file.text.length;
    let startLanguage = source.language;
    if (section) {
      const statements = inspectModelSourceFile(
        source.language,
        path,
        file.text,
      ).statements;
      const opening = statements.findIndex(
        (s) =>
          s.kind === "library" &&
          s.mode === "section-start" &&
          modelSourceSectionKey(source, path, s.section, s.sourceRef) ===
            sectionKey(section),
      );
      const closing = statements.find(
        (s, index) =>
          index > opening && s.kind === "library" && s.mode === "section-end",
      );
      if (opening < 0 || !closing)
        throw new Error(`Missing model library section ${section}`);
      start = statements[opening]!.sourceRef.end.offset;
      end = closing.sourceRef.start.offset;
      startLanguage = statements[opening]!.sourceLanguage ?? source.language;
    }
    if (source.language === "spectre" && callerLanguage)
      result.text += `simulator lang=${startLanguage}\n`;
    let offset = start;
    for (const include of includes
      .filter(
        (i) =>
          i.path === path &&
          i.sourceRef.start.offset >= start &&
          i.sourceRef.end.offset <= end,
      )
      .sort((a, b) => a.sourceRef.start.offset - b.sourceRef.start.offset)) {
      append(
        path,
        file.text.slice(offset, include.sourceRef.start.offset),
        offset,
      );
      const load = inspected.graph.statements.find(
        (s) =>
          s.path === path &&
          s.statement.sourceRef.start.offset === include.sourceRef.start.offset,
      );
      if (source.files.some((f) => f.path === include.target))
        emit(
          include.target,
          include.section,
          [...stack, identity],
          load?.statement.sourceLanguage ?? source.language,
        );
      else {
        const outputParts = (options.outputPath ?? "netlist.spice")
          .split("/")
          .slice(0, -1);
        const targetParts = include.target.split("/");
        while (outputParts.length && outputParts[0] === targetParts[0]) {
          outputParts.shift();
          targetParts.shift();
        }
        const requested = [...outputParts.map(() => ".."), ...targetParts].join(
          "/",
        );
        // Dependency paths have one declared owner. Only this generated load
        // changes; surrounding native bytes retain exact reverse mappings.
        result.text +=
          (load?.statement.sourceLanguage ?? source.language) === "spectre"
            ? `include "${requested}"${include.section ? " section=" + include.section : ""}\n`
            : include.section
              ? `.lib "${requested}" ${include.section}\n`
              : `.include "${requested}"\n`;
      }
      offset = include.sourceRef.end.offset;
    }
    append(path, file.text.slice(offset, end), offset);
    if (source.language === "spectre" && callerLanguage) {
      // Owned files need not end with a newline. The separator is generated,
      // not an authored byte, so leave it outside reverse source mappings.
      if (!result.text.endsWith("\n")) result.text += "\n";
      result.text += `simulator lang=${callerLanguage}\n`;
    }
  };
  emit(source.entry);
  if (options.format && options.format !== source.language) {
    const failure = modelSourceLibraryDialectDiagnostic(source, options.format);
    if (failure) throw Error(failure.message);
    const converted = convertExpandedModelSource(
      source,
      result.text,
      options.format,
      options.conversionLocations,
    );
    if (converted.status === "blocked")
      throw Error(converted.issues[0]!.message);
    if (converted.lineOrigins) {
      const starts = [0];
      for (let i = 0; i < result.text.length; i++)
        if (result.text[i] === "\n") starts.push(i + 1);
      let outputOffset = 0;
      const segments: ProjectModelSourceLocation[] = [];
      for (const [index, line] of converted.text.split("\n").entries()) {
        const inputOffset = starts[(converted.lineOrigins[index] ?? 0) - 1];
        const owner =
          inputOffset === undefined
            ? undefined
            : result.segments.find(
                (s) =>
                  inputOffset >= s.startOffset && inputOffset < s.endOffset,
              );
        if (owner && inputOffset !== undefined)
          segments.push({
            ...owner,
            startOffset: outputOffset,
            endOffset: outputOffset + line.length + 1,
            sourceOffset: owner.sourceOffset + inputOffset - owner.startOffset,
            sourceLength:
              (starts[converted.lineOrigins[index] ?? 0] ??
                result.text.length) - inputOffset,
            derived: true,
          });
        outputOffset += line.length + 1;
      }
      result.segments = segments;
    } else
      result.segments = [
        {
          sourceId: source.id,
          revision: source.revision,
          path: source.entry,
          startOffset: 0,
          endOffset: converted.text.length,
          sourceOffset: 0,
          derived: true,
          sourceLength: source.files.find((f) => f.path === source.entry)!.text
            .length,
        },
      ];
    result.text = converted.text;
  }
  return result;
}

export function projectModelText(source: ProjectModelSource): string {
  return renderProjectModelSource(source).text;
}

/** Append applied owners with the same native bytes and reverse spans in every design view. */
export function appendProjectModelSources(
  text: string,
  sources: readonly ProjectModelSource[],
  format: "spice" | "spectre" | "vacask" = "spice",
  reservedNames: Iterable<string> = [],
): PrintedProjectModelSource {
  const segments: ProjectModelSourceLocation[] = [];
  const reserved = new Set(reservedNames);
  if (format === "vacask") {
    for (const source of sources)
      for (const entry of inspectProjectModelSource(source).entries)
        reserved.add(entry.name);
  }
  for (const source of sources) {
    if (format === "vacask")
      for (const s of inspectVacaskSource("generated", text, false).statements)
        if (
          ["model", "subckt"].includes(s.tokens[0]?.value ?? "") &&
          s.tokens[1]
        )
          reserved.add(s.tokens[1].value);
    const model = renderProjectModelSource(source, {
      format,
      reservedNames: reserved,
    });
    text += `\n${format === "spice" ? "*" : "//"} Project model: applied version ${source.revision}${source.draft ? " (draft pending)" : ""}\n`;
    const offset = text.length;
    text += model.text;
    segments.push(
      ...model.segments.map((segment) => ({
        ...segment,
        startOffset: segment.startOffset + offset,
        endOffset: segment.endOffset + offset,
      })),
    );
  }
  return { text, segments };
}

/** A bounded text change reverses only when it has one exact model-file owner. */
export function planMappedProjectModelEdit(
  original: string,
  next: string,
  locations: readonly ProjectModelSourceLocation[],
  snapshots: readonly ProjectModelSource[],
):
  | { matched: false }
  | { matched: true; ok: true; modelUpdates: ProjectModelSource[] }
  | { matched: true; ok: false; code: string; message: string } {
  if (original === next || !locations.length) return { matched: false };
  let start = 0;
  while (
    start < original.length &&
    start < next.length &&
    original[start] === next[start]
  )
    start++;
  let suffix = 0;
  while (
    suffix < original.length - start &&
    suffix < next.length - start &&
    original[original.length - suffix - 1] === next[next.length - suffix - 1]
  )
    suffix++;
  const end = original.length - suffix;
  const touched = locations.filter(
    (s) => start <= s.endOffset && end >= s.startOffset,
  );
  if (!touched.length) return { matched: false };
  const fail = (message: string) => ({
    matched: true as const,
    ok: false as const,
    code: "MODEL_SOURCE_EDIT_REQUIRES_OWNER",
    message: `${message}. Open the shared model source in Cell Manager; the experiment was not changed`,
  });
  const owner = locations.find(
    (s) => start >= s.startOffset && end <= s.endOffset,
  );
  if (!owner)
    return fail("This edit crosses protected source or file boundaries");
  if (owner.derived)
    return fail("Converted model text requires an edit at its native owner");
  const source = snapshots.find((s) => s.id === owner.sourceId);
  const file = source?.files.find((f) => f.path === owner.path);
  if (!source || !file || source.revision !== owner.revision)
    return fail("The model source mapping is stale");
  if (source.draft) return fail("A saved model draft is pending");
  const from = owner.sourceOffset + start - owner.startOffset;
  const to = owner.sourceOffset + end - owner.startOffset;
  const update = structuredClone(source);
  update.files.find((f) => f.path === file.path)!.text =
    file.text.slice(0, from) +
    next.slice(start, next.length - suffix) +
    file.text.slice(to);
  const before = inspectProjectModelSource(source);
  const after = inspectProjectModelSource(update);
  const failure = after.diagnostics.find((d) => d.severity === "error");
  if (failure) return fail(failure.message);
  const declarations = (inspection: typeof before) =>
    inspection.entries.map((e) => ({
      name: e.name,
      ports: e.ports,
      parameters: e.parameters.map((p) => p.name),
    }));
  const loads = (inspection: typeof before) =>
    inspection.graph.includes.map(({ path, target, section }) => ({
      path,
      target,
      section,
    }));
  if (
    JSON.stringify(declarations(before)) !==
      JSON.stringify(declarations(after)) ||
    JSON.stringify(loads(before)) !== JSON.stringify(loads(after))
  )
    return fail("Edit model interfaces and dependencies at their owner");
  return { matched: true, ok: true, modelUpdates: [update] };
}
