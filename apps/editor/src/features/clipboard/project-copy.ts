import {
  createEmptyProject,
  ComponentDefinitionSchema,
  deriveStableId,
  routeEnd,
  type CircuitProject,
  type Point,
  type SchematicDocument,
  type VisualAnchor,
} from "@icm/model";
import {
  resolveVisualAnchor,
  resolveDocumentRoutingGeometry,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import {
  builtInSymbols,
  withProjectComponentDefinitions,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
} from "@icm/symbols";
import {
  executeProjectTransaction,
  executeTransaction,
  gateRoutingOperationPlan,
  planExternalCopyDependencies,
  planProjectCellImport,
  remapCopySourceFiles,
  remapExternalCopyInstance,
  referencedSourceFiles,
  type CopyDependencySource,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import {
  captureDocumentComposition,
  copySelection,
  proposePaste,
  type ExplicitCopyRoutingSelection,
  type SchematicClipboard,
} from "./clipboard";

import { planInsertedInstanceConnections } from "../component-insert/placement-connectivity";

/** Dependency closure shared by canvas composition and the system clipboard. */
export interface CopyContext extends CopyDependencySource {
  documents: SchematicDocument[];
  presentation: SchematicDocument["presentation"];
  componentDefinitions?: CircuitProject["componentDefinitions"];
  simulationFolders?: CircuitProject["simulationFolders"];
}

export function captureProjectCopy(
  project: CircuitProject,
  document: SchematicDocument,
  selection?: ExplicitCopyRoutingSelection & {
    instanceIds: readonly string[];
    draftingIds: readonly string[];
  },
  preserveElectrical = false,
): SchematicClipboard | null {
  const clipboard = selection
    ? copySelection(
        document,
        selection.instanceIds,
        selection.draftingIds,
        selection,
        preserveElectrical,
      )
    : captureDocumentComposition(document);
  if (!clipboard) return null;
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  // Preserve source Cell parameter context for partial copies as well as whole scenes.
  clipboard.formalParameters = structuredClone(
    document.netlist?.formalParameters ?? [],
  );
  const selectedInstances = new Set(clipboard.instances.map((i) => i.id));
  const geometry = resolveDocumentRoutingGeometry(document, resolver);
  const netIds = new Set(clipboard.nets.map((n) => n.id));
  // Explicit wires can be copied without their connected devices. Materialize their
  // cut endpoints at the resolved pin positions, never carry a foreign terminal ID.
  for (const routeId of selection?.routeIds ?? []) {
    const source = document.routes.find((r) => r.id === routeId);
    if (!source || clipboard.routes.some((r) => r.id === routeId)) continue;
    clipboard.routes.push(structuredClone(source));
  }
  for (const route of clipboard.routes) {
    if (!netIds.has(route.netId)) {
      const net = document.nets.find((n) => n.id === route.netId);
      if (!net) throw new Error(`Copied Wire ${route.id} has no Net`);
      clipboard.nets.push({
        ...structuredClone(net),
        terminals: net.terminals.filter((t) =>
          selectedInstances.has(t.instanceId),
        ),
      });
      netIds.add(net.id);
    }
    for (const [index, endpoint] of [route.start, routeEnd(route)].entries()) {
      if (endpoint.kind === "junction") {
        const source = document.junctions.find(
          (j) => j.id === endpoint.junctionId,
        );
        if (source && !clipboard.junctions.some((j) => j.id === source.id))
          clipboard.junctions.push(structuredClone(source));
      } else if (!selectedInstances.has(endpoint.instanceId)) {
        const resolved = geometry.routes.get(route.id);
        const position =
          index === 0 ? resolved?.centerline[0] : resolved?.centerline.at(-1);
        if (!position)
          throw new Error(`Cannot resolve copied Wire endpoint: ${route.id}`);
        const junctionId = deriveStableId("copy-cut", route.id, String(index));
        clipboard.junctions.push({
          id: junctionId,
          netId: route.netId,
          position: { ...position },
          role: "route-anchor",
        });
        const detached = { kind: "junction" as const, junctionId };
        if (index === 0) route.start = detached;
        else
          route.legs[route.legs.length - 1]!.to = {
            kind: "endpoint",
            endpoint: detached,
          };
      }
    }
  }
  // A junction/label can be copied alone. The transport still needs a closed
  // Net record even when none of its original component terminals are selected.
  if (preserveElectrical) {
    const referencedNets = [
      ...clipboard.junctions.map((item) => item.netId),
      ...clipboard.cellTerminals.map((item) => item.netId),
      ...clipboard.annotations.flatMap((item) =>
        item.netId ? [item.netId] : [],
      ),
    ];
    for (const id of referencedNets) {
      if (netIds.has(id)) continue;
      const net = document.nets.find((item) => item.id === id);
      if (!net)
        throw new Error(`Copied object references an unavailable Net: ${id}`);
      clipboard.nets.push({
        ...structuredClone(net),
        terminals: net.terminals.filter((terminal) =>
          selectedInstances.has(terminal.instanceId),
        ),
      });
      netIds.add(id);
    }
  }
  const copiedRoutes = new Set(clipboard.routes.map((r) => r.id));
  // A selected Wire carries its own attached marker, even if its devices were cut.
  for (const annotation of document.annotations) {
    if (
      ((annotation.anchor.kind === "route" &&
        copiedRoutes.has(annotation.anchor.routeId)) ||
        selection?.annotationIds.includes(annotation.id)) &&
      !clipboard.annotations.some((a) => a.id === annotation.id)
    )
      clipboard.annotations.push(structuredClone(annotation));
  }
  const owners = new Set(
    [
      ...clipboard.instances,
      ...clipboard.routes,
      ...clipboard.junctions,
      ...clipboard.annotations,
      ...clipboard.draftingObjects,
    ].map((o) => o.id),
  );
  const detachVisual = (anchor: VisualAnchor): VisualAnchor => {
    const internal =
      anchor.kind === "free" ||
      (anchor.kind === "object"
        ? owners.has(anchor.objectId)
        : copiedRoutes.has(anchor.routeId));
    if (internal) return anchor;
    const resolved = resolveVisualAnchor(document, resolver, anchor, geometry);
    if (!resolved.resolved)
      throw new Error(
        resolved.diagnostic?.message ?? "Copied anchor cannot be resolved",
      );
    return { kind: "free", position: resolved.position };
  };
  for (const object of clipboard.draftingObjects) {
    object.anchor = detachVisual(object.anchor);
    if (object.kind === "arrow") {
      object.from = detachVisual(object.from);
      object.to = detachVisual(object.to);
    } else if (object.kind === "leader" || object.kind === "callout")
      object.target = detachVisual(object.target);
  }
  for (const annotation of clipboard.annotations) {
    // Electrical owners must travel with their label; never detach a binding.
    const binding = annotation.binding;
    if (
      binding &&
      "instanceId" in binding &&
      !selectedInstances.has(binding.instanceId)
    )
      throw new Error("Copy the component together with its bound label");
    annotation.anchor = detachVisual(annotation.anchor);
  }
  clipboard.annotations = clipboard.annotations.filter((annotation) => {
    const binding = annotation.binding;
    return (
      binding?.kind !== "cell-terminal-name" ||
      clipboard.cellTerminals.some((t) => t.id === binding.terminalId)
    );
  });
  // System clipboard composition preserves electrical context; ordinary C
  // still creates fresh insertions without source circuit dependencies.
  if (!selection || preserveElectrical) {
    // Bulk defaults and overrides are actual electrical dependencies, not copied boundary wires.
    const whole = captureDocumentComposition(document);
    for (const instance of clipboard.instances) {
      const materialized = whole?.instances.find((i) => i.id === instance.id);
      const binding = materialized?.mosBulkBinding;
      if (!binding) continue;
      instance.mosBulkBinding = { ...binding, origin: "instance-override" };
      if (!netIds.has(binding.netId)) {
        const net = whole?.nets.find((n) => n.id === binding.netId);
        if (!net) throw new Error(`Missing bulk Net ${binding.netId}`);
        clipboard.nets.push({
          ...structuredClone(net),
          terminals: net.terminals.filter((t) =>
            selectedInstances.has(t.instanceId),
          ),
        });
        netIds.add(net.id);
      }
      const copiedNet = clipboard.nets.find((net) => net.id === binding.netId)!;
      if (
        !copiedNet.terminals.some(
          (terminal) =>
            terminal.instanceId === instance.id && terminal.pinName === "B",
        )
      )
        copiedNet.terminals.push({ instanceId: instance.id, pinName: "B" });
    }
    // A name is an electrical dependency even when its original visible owner lies
    // outside the selection. Give the copied Net its own label, not a foreign owner.
    const logicalNets = resolveDocumentLogicalNets(document);
    for (const net of clipboard.nets) {
      if (
        clipboard.cellTerminals.some((t) => t.netId === net.id) ||
        clipboard.connectivityEvidence.some(
          (e) => e.kind === "name-claim" && e.netId === net.id,
        )
      )
        continue;
      const logical = logicalNets.byBaseNetId.get(net.id);
      if (!logical?.name) continue;
      if (logical.conflicts.length)
        throw new Error(
          `Copied Net ${logical.name} has conflicting source name semantics`,
        );
      const route = clipboard.routes.find((r) => r.netId === net.id);
      const terminal = net.terminals[0];
      const position = (route
        ? geometry.routes.get(route.id)?.centerline[0]
        : undefined) ??
        clipboard.instances.find((i) => i.id === terminal?.instanceId)
          ?.placement?.position ?? { x: 0, y: 0 };
      const id = deriveStableId("copy-net-name", net.id);
      clipboard.annotations.push({
        id,
        kind: "net-label",
        netId: net.id,
        binding: { kind: "net-name", netId: net.id },
        anchor: { kind: "free", position: { ...position } },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
      clipboard.connectivityEvidence.push({
        id: deriveStableId("copy-net-claim", net.id),
        kind: "name-claim",
        netId: net.id,
        name: logical.name,
        scope: logical.scope ?? "local",
        owner: { kind: "net-label", annotationId: id },
        ...(logical.powerDomain === "vdd" || logical.powerDomain === "ground"
          ? { powerDomain: logical.powerDomain }
          : {}),
      });
    }
  }
  const documents = new Map<string, SchematicDocument>();
  const visit = (instances: SchematicDocument["instances"]): void => {
    for (const instance of instances) {
      const binding = instance.netlist?.binding;
      if (
        binding?.kind !== "subcircuit" ||
        documents.has(binding.childDocumentId)
      )
        continue;
      const child = project.documents.find(
        (d) => d.id === binding.childDocumentId,
      );
      if (!child)
        throw new Error(`Missing copied Cell ${binding.childDocumentId}`);
      documents.set(child.id, child);
      visit(child.instances);
    }
  };
  visit(clipboard.instances);
  const instances = [
    ...clipboard.instances,
    ...[...documents.values()].flatMap((d) => d.instances),
  ];
  const externalIds = new Set(
    instances.flatMap((i) =>
      i.netlist?.binding?.kind === "external-subcircuit"
        ? [i.netlist.binding.definitionId]
        : [],
    ),
  );
  const fileIds = referencedSourceFiles([clipboard, [...documents.values()]]);
  const componentProject = withProjectComponentDefinitions({
    ...project,
    documents: [
      {
        ...document,
        instances: clipboard.instances,
        drafting: { objects: clipboard.draftingObjects },
      },
      ...documents.values(),
    ],
  });
  const copiedDocumentIds = new Set([document.id, ...documents.keys()]);
  clipboard.context = structuredClone({
    id: project.id,
    symbolLibrary: project.symbolLibrary,
    source: {
      ...project.source,
      files: project.source.files.filter((f) => fileIds.has(f.id)),
    },
    externalSubcircuitDefinitions: project.externalSubcircuitDefinitions.filter(
      (d) => externalIds.has(d.id),
    ),
    documents: [...documents.values()],
    presentation: document.presentation,
    componentDefinitions: componentProject.componentDefinitions,
    // Simulation source belongs to the complete Cell, not a partial selection.
    simulationFolders: !selection
      ? project.simulationFolders.filter(
          (folder) =>
            folder.input.circuitBindings.length > 0 &&
            folder.input.circuitBindings.every((binding) =>
              copiedDocumentIds.has(binding.documentId),
            ),
        )
      : [],
  });
  return clipboard;
}

/** Resolve dependencies once per Project revision/orientation, not per pointer move. */
export function prepareProjectCopy(
  project: CircuitProject,
  document: SchematicDocument,
  sourceClipboard: SchematicClipboard,
) {
  let clipboard = structuredClone(sourceClipboard);
  const dependencyMapping = {
    cells: {} as Record<string, string>,
    files: {} as Record<string, string>,
  };
  let prepared = project;
  const edits: ProjectStructureEdit[] = [];
  const install = (additional: readonly ProjectStructureEdit[]) => {
    if (!additional.length) return;
    const result = executeProjectTransaction(prepared, {
      transactionId: "prepare-copy-dependencies",
      projectId: prepared.id,
      expectedStructureRevision: prepared.structureRevision,
      actor: { kind: "human", id: "copy-preview" },
      edits: [...additional],
      dryRun: true,
    });
    if (!result.ok)
      throw new Error(result.diagnostics[0]?.message ?? result.error.message);
    prepared = result.proposedProject;
    edits.push(...additional);
  };
  const context = clipboard.context;
  let componentDefinitions = project.componentDefinitions;
  if (context?.componentDefinitions?.length) {
    // Schema normalization makes equality independent of object-key order and
    // omitted defaults; identical definitions must not fork on every paste.
    componentDefinitions = (
      withProjectComponentDefinitions(project).componentDefinitions ?? []
    ).map((definition) => ComponentDefinitionSchema.parse(definition));
    const symbolIds = new Map<string, string>();
    for (const rawDefinition of context.componentDefinitions) {
      const definition = ComponentDefinitionSchema.parse(rawDefinition);
      // Cell/external symbols are regenerated from their imported interfaces.
      if (definition.generatedFrom) continue;
      const originalId = definition.symbol.id;
      let id = originalId;
      let ordinal = 1;
      let existing = componentDefinitions.find((item) => item.symbol.id === id);
      const withId = (nextId: string) => ({
        ...definition,
        symbol: { ...definition.symbol, id: nextId },
        ...(definition.electrical
          ? { electrical: { ...definition.electrical, symbolId: nextId } }
          : {}),
        ...(definition.subcircuit
          ? { subcircuit: { ...definition.subcircuit, symbolId: nextId } }
          : {}),
      });
      while (
        existing &&
        JSON.stringify(existing) !== JSON.stringify(withId(id))
      ) {
        id = `${originalId}-copy-${ordinal++}`;
        existing = componentDefinitions.find((item) => item.symbol.id === id);
      }
      symbolIds.set(originalId, id);
      if (!existing) componentDefinitions.push(withId(id));
    }
    const remap = (
      instances: SchematicDocument["instances"],
      objects: SchematicClipboard["draftingObjects"],
    ) => {
      for (const instance of instances)
        instance.symbolId =
          symbolIds.get(instance.symbolId) ?? instance.symbolId;
      for (const object of objects)
        if (object.kind === "floating-symbol")
          object.symbolId = symbolIds.get(object.symbolId) ?? object.symbolId;
    };
    remap(clipboard.instances, clipboard.draftingObjects);
    for (const child of context.documents)
      remap(child.instances, child.drafting?.objects ?? []);
    prepared = { ...project, componentDefinitions };
  }
  if (context) {
    if (
      JSON.stringify(context.symbolLibrary) !==
      JSON.stringify(project.symbolLibrary)
    )
      throw new Error("Copied content uses an incompatible Symbol Library");
    const appearance = (p: SchematicDocument["presentation"]) =>
      JSON.stringify([p.styleProfileId, p.styleOverrides ?? {}]);
    if (appearance(context.presentation) !== appearance(document.presentation))
      throw new Error(
        "Copy cannot preserve appearance across different document style defaults; use matching styles or keep the circuit in its own Cell",
      );
    const dependencies = planExternalCopyDependencies(
      prepared,
      context,
      [
        ...clipboard.instances,
        ...context.documents.flatMap((d) => d.instances),
      ],
      [{ ...clipboard, context: undefined }, context.documents],
    );
    install(dependencies.edits);
    Object.assign(
      dependencyMapping.files,
      Object.fromEntries(dependencies.fileIds),
    );
    clipboard = remapCopySourceFiles(clipboard, dependencies.fileIds);
    clipboard.instances = clipboard.instances.map((i) =>
      remapExternalCopyInstance(i, dependencies.externalIds),
    );
    const childMap = new Map<string, string>();
    const mapChildClosure = (sourceId: string, targetId: string): void => {
      if (childMap.has(sourceId)) return;
      childMap.set(sourceId, targetId);
      const sourceChild = context.documents.find(
        (item) => item.id === sourceId,
      );
      const targetChild = prepared.documents.find(
        (item) => item.id === targetId,
      );
      sourceChild?.instances.forEach((instance, index) => {
        const from = instance.netlist?.binding;
        const to = targetChild?.instances[index]?.netlist?.binding;
        if (from?.kind === "subcircuit" && to?.kind === "subcircuit")
          mapChildClosure(from.childDocumentId, to.childDocumentId);
      });
    };
    const canReuseSourceCells =
      context.id === project.id &&
      context.documents.every(
        (child) =>
          JSON.stringify(project.documents.find((d) => d.id === child.id)) ===
          JSON.stringify(child),
      ) &&
      context.source.files.every(
        (file) =>
          JSON.stringify(project.source.files.find((f) => f.id === file.id)) ===
          JSON.stringify(file),
      );
    for (const instance of clipboard.instances) {
      const binding = instance.netlist?.binding;
      if (binding?.kind !== "subcircuit") continue;
      const sourceId = binding.childDocumentId;
      let targetId = childMap.get(sourceId);
      if (!targetId) {
        const child = context.documents.find((d) => d.id === sourceId);
        if (!child) throw new Error(`Missing copied Cell ${sourceId}`);
        const existing = prepared.documents.find((d) => d.id === sourceId);
        if (
          canReuseSourceCells &&
          existing &&
          JSON.stringify(existing) === JSON.stringify(child)
        )
          targetId = sourceId;
        else {
          // Content participates in import identity: a changed source is a new snapshot.
          const source = createEmptyProject(
            deriveStableId(
              "copy-source",
              context.id,
              JSON.stringify(context.documents),
            ),
            "Copy dependencies",
            sourceId,
          );
          source.documents = structuredClone(context.documents);
          source.componentDefinitions = componentDefinitions;
          source.source = structuredClone(context.source);
          source.symbolLibrary = structuredClone(context.symbolLibrary);
          source.externalSubcircuitDefinitions = structuredClone(
            context.externalSubcircuitDefinitions,
          );
          const plan = planProjectCellImport(prepared, source, sourceId, {
            sharedSnapshot: true,
          });
          if (!plan.ok) throw new Error(plan.message);
          install(plan.edits);
          targetId = plan.rootDocumentId;
        }
        mapChildClosure(sourceId, targetId);
      }
      binding.childDocumentId = targetId;
      const child = prepared.documents.find((d) => d.id === targetId)!;
      instance.symbolId = hierarchicalSymbolId(
        child.netlist?.name ?? child.name,
      );
    }
    childMap.set(clipboard.sourceDocumentId, document.id);
    Object.assign(dependencyMapping.cells, Object.fromEntries(childMap));
    for (const sourceFolder of context.simulationFolders ?? []) {
      const folder = structuredClone(sourceFolder);
      for (const binding of folder.input.circuitBindings) {
        const id = childMap.get(binding.documentId);
        if (!id)
          throw new Error(
            `Copied simulation source references an unavailable Cell: ${binding.documentId}`,
          );
        binding.documentId = id;
      }
      for (const draft of folder.input.drafts ?? []) {
        if (draft.binding) {
          const id = childMap.get(draft.binding.documentId);
          if (!id)
            throw new Error(
              "Copied simulation draft references an unavailable Cell",
            );
          draft.binding.documentId = id;
        }
      }
      const base = deriveStableId(
        "copy-folder",
        project.id,
        context.id,
        folder.id,
      );
      if (
        prepared.simulationFolders.some(
          (item) =>
            (item.id === base ||
              item.id.startsWith(`${base}-`) ||
              (context.id === project.id && item.id === folder.id)) &&
            JSON.stringify(item.input) === JSON.stringify(folder.input),
        )
      )
        continue;
      folder.id = base;
      let ordinal = 1;
      while (prepared.simulationFolders.some((item) => item.id === folder.id))
        folder.id = `${base}-${ordinal++}`;
      const name = folder.name;
      ordinal = 1;
      while (
        prepared.simulationFolders.some(
          (item) => item.name.toLowerCase() === folder.name.toLowerCase(),
        )
      )
        folder.name = `${name.slice(0, 110)} (copy ${ordinal++})`;
      install([{ kind: "upsert_simulation_folder", folder }]);
    }
  }
  const resolver = createProjectSymbolResolver(prepared, builtInSymbols);
  for (const instance of clipboard.instances) {
    if (!resolver.resolve(instance.symbolId))
      throw new Error(`Copied Symbol is unavailable: ${instance.symbolId}`);
  }
  const preflight = proposePaste(
    document,
    clipboard,
    { x: 0, y: 0 },
    0,
    prepared,
  );
  if (preflight.errors.length) throw new Error(preflight.errors.join("; "));
  return {
    clipboard,
    dependencyMapping,
    dependencyEdits: edits,
    resolver,
    baseProject: {
      ...project,
      ...(componentDefinitions ? { componentDefinitions } : {}),
    },
  };
}

export function planProjectCopyPlacement(
  project: CircuitProject,
  document: SchematicDocument,
  clipboard: SchematicClipboard,
  offset: Point,
  sequence: number,
) {
  const prepared = prepareProjectCopy(project, document, clipboard);
  const proposal = proposePaste(
    document,
    prepared.clipboard,
    offset,
    sequence,
    prepared.baseProject,
  );
  if (proposal.errors.length) throw new Error(proposal.errors.join("; "));
  const gate = gateRoutingOperationPlan(document, proposal.operationPlan, {
    symbolResolver: prepared.resolver,
  });
  if (!gate.ok)
    throw new Error(
      `${gate.message}: ${gate.diagnostics.map((d) => `${d.path?.join(".") ?? ""} ${d.message}`).join("; ")}`,
    );
  const changesInterface = gate.edits.some(
    (e) => e.kind === "add_cell_terminal" || e.kind === "update_cell_terminal",
  );
  const edits: ProjectStructureEdit[] = [
    ...prepared.dependencyEdits,
    {
      kind: "transact_document",
      documentId: document.id,
      expectedRevision: document.revision,
      edits: [
        ...gate.edits,
        ...(changesInterface
          ? [
              {
                kind: "set_cell_symbol_presentation" as const,
                presentation: document.presentation.cellSymbol ?? null,
              },
            ]
          : []),
      ],
    },
  ];
  if (clipboard.intent === "clone-selection") {
    let projected = gate.evaluated.finalDocument;
    for (const id of proposal.instanceIds) {
      const instance = projected.instances.find(
        (candidate) => candidate.id === id,
      )!;
      const connections = planInsertedInstanceConnections(
        projected,
        prepared.resolver,
        instance,
      );
      if (!connections.edits.length) continue;
      // Contact planning reads canonical endpoint bonds after insertion. Keep
      // that stage boundary inside one atomic, undoable Project transaction.
      const step: ProjectStructureEdit = {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: projected.revision,
        edits: connections.edits,
      };
      const result = executeTransaction(
        projected,
        {
          transactionId: "copy-insert-contact",
          documentId: projected.id,
          expectedRevision: projected.revision,
          actor: { kind: "human", id: "copy-insert" },
          edits: connections.edits,
        },
        { symbolResolver: prepared.resolver },
      );
      if (!result.ok) throw new Error(result.error.message);
      projected = result.document;
      edits.push(step);
    }
  }
  if (edits.length > 256)
    throw new Error("Copy exceeds the atomic Project transaction limit");
  return {
    edits,
    instanceIds: proposal.instanceIds,
    mapping: {
      objects: { ...proposal.idRemap },
      ...prepared.dependencyMapping,
    },
    baseProject: prepared.baseProject,
  };
}

/** Install dependencies and placement in one undoable Project revision. */
export function applyProjectCopyPlacement(
  plan: ReturnType<typeof planProjectCopyPlacement>,
  actor: { kind: "human" | "agent"; id: string } = {
    kind: "human",
    id: "clipboard",
  },
): CircuitProject {
  const project = plan.baseProject;
  const result = executeProjectTransaction(project, {
    transactionId: "copy-placement",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor,
    edits: plan.edits,
  });
  if (!result.ok)
    throw new Error(result.diagnostics[0]?.message ?? result.error.message);
  return result.project;
}
