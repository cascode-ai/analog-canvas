import type {
  CircuitProject,
  ProjectModelSource,
  ExternalSubcircuitDefinition,
} from "@icm/model";
import {
  inspectSimulationSource,
  type SubcircuitStartStatement,
  type ModelStatement,
} from "@icm/spice";
import { inspectSimulationSourceGraph } from "./simulation-source-graph.js";
import type { SimulationSourceDiagnostic } from "./source-file-graph.js";
import { resolveReviewedLibraryInterface } from "@icm/devices";

/** Native inspection retains opaque bodies; acceptance is not simulator qualification. */
export function inspectProjectModelSource(source: ProjectModelSource) {
  const graph = inspectSimulationSourceGraph({
    kind: "source",
    entry: source.entry,
    configPath: "__model_config.json",
    files: source.files,
    dependencies: source.dependencies,
    circuitBindings: [],
  });
  const diagnostics = [...graph.diagnostics];
  const entries: SubcircuitStartStatement[] = [];
  const names = new Set<string>();
  const globalModels: ModelStatement[] = [];
  const deviceModelNames = new Set<string>();
  let current: SubcircuitStartStatement | undefined;
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
      if (names.has(statement.name.toLowerCase()))
        fail(`Duplicate model definition ${statement.name}`);
      names.add(statement.name.toLowerCase());
      current = statement;
      entries.push(statement);
      if (
        new Set(statement.ports.map((p) => p.toLowerCase())).size !==
        statement.ports.length
      )
        fail("Model terminal names must be unique");
      if (
        new Set(statement.parameters.map((p) => p.name.toLowerCase())).size !==
        statement.parameters.length
      )
        fail("Model formal parameter names must be unique");
    } else if (statement.kind === "subckt_end") {
      if (
        !current ||
        (statement.name &&
          statement.name.toLowerCase() !== current.name.toLowerCase())
      )
        fail("Model .ends does not match its declaration");
      current = undefined;
    } else if (statement.kind === "model") {
      const identity = JSON.stringify([
        current?.name.toLowerCase(),
        statement.name.toLowerCase(),
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
  return { entries, globalModels, graph, diagnostics };
}

export function modelInterfaceMatches(
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
  const names = new Set(
    (options.reservedNames ?? []).map((n) => n.toLowerCase()),
  );
  const seen = new Set<string>();
  const deviceModelNames = new Set<string>();
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
    const entry = inspected.entries.find(
      (e) => e.name.toLowerCase() === implementation.entry.toLowerCase(),
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
    if (options.format && options.format !== "spice")
      diagnostics.push({
        code: "MODEL_SOURCE_DIALECT",
        severity: "error",
        message: `SPICE model ${definition.name} cannot be silently emitted as ${options.format}`,
        path: entry?.sourceRef.fileId ?? source.entry,
        ...(entry ? { sourceRef: entry.sourceRef } : {}),
        modelSource,
      });
    for (const declared of inspected.entries) {
      if (names.has(declared.name.toLowerCase()))
        diagnostics.push({
          code: "MODEL_SOURCE_NAME_CONFLICT",
          severity: "error",
          message: `Model definition conflicts with ${declared.name}`,
          path: declared.sourceRef.fileId,
          sourceRef: declared.sourceRef,
          modelSource,
        });
      names.add(declared.name.toLowerCase());
    }
    for (const declared of inspected.globalModels) {
      if (deviceModelNames.has(declared.name.toLowerCase()))
        diagnostics.push({
          code: "MODEL_SOURCE_NAME_CONFLICT",
          severity: "error",
          message: `Global device model conflicts with ${declared.name}`,
          path: declared.sourceRef.fileId,
          sourceRef: declared.sourceRef,
          modelSource,
        });
      deviceModelNames.add(declared.name.toLowerCase());
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
}

export interface PrintedProjectModelSource {
  text: string;
  segments: ProjectModelSourceLocation[];
}

/** Expand only owned include references; native body bytes and external loads survive. */
export function renderProjectModelSource(
  source: ProjectModelSource,
  options: { outputPath?: string } = {},
): PrintedProjectModelSource {
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
  const emit = (path: string, section?: string, stack: string[] = []) => {
    const file = source.files.find((f) => f.path === path);
    if (!file) throw new Error(`Missing owned model file ${path}`);
    const identity = JSON.stringify([path, section?.toLowerCase()]);
    if (stack.includes(identity))
      throw new Error(`Model include cycle at ${path}`);
    let start = 0;
    let end = file.text.length;
    if (section) {
      const statements = inspectSimulationSource(
        { path, id: path, text: file.text, hash: "", encoding: "utf-8" },
        false,
      ).statements;
      const opening = statements.findIndex(
        (s) =>
          s.kind === "library" &&
          s.mode === "section-start" &&
          s.section.toLowerCase() === section.toLowerCase(),
      );
      const closing = statements.find(
        (s, index) =>
          index > opening && s.kind === "library" && s.mode === "section-end",
      );
      if (opening < 0 || !closing)
        throw new Error(`Missing model library section ${section}`);
      start = statements[opening]!.sourceRef.end.offset;
      end = closing.sourceRef.start.offset;
    }
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
      if (source.files.some((f) => f.path === include.target))
        emit(include.target, include.section, [...stack, identity]);
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
        result.text += include.section
          ? `.lib "${requested}" ${include.section}\n`
          : `.include "${requested}"\n`;
      }
      offset = include.sourceRef.end.offset;
    }
    append(path, file.text.slice(offset, end), offset);
  };
  emit(source.entry);
  return result;
}

export function projectModelText(source: ProjectModelSource): string {
  return renderProjectModelSource(source).text;
}

/** Append applied owners with the same native bytes and reverse spans in every design view. */
export function appendProjectModelSources(
  text: string,
  sources: readonly ProjectModelSource[],
): PrintedProjectModelSource {
  const segments: ProjectModelSourceLocation[] = [];
  for (const source of sources) {
    const model = renderProjectModelSource(source);
    text += `\n* Project model: applied version ${source.revision}${source.draft ? " (draft pending)" : ""}\n`;
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
