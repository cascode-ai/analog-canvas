import {
  CircuitProjectSchema,
  foldNetName,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import {
  resolveDocumentLogicalNets,
  resolveMosBulkConnection,
} from "@icm/derived";
import { hierarchicalSymbolId } from "@icm/symbols";
import {
  planProjectCellImport,
  remapImportedIdentifierValues,
} from "./project-cell-import.js";
import { executeProjectTransaction } from "./project-transaction.js";

/**
 * Compose a staged Cell into an existing identity. Dependency closure and every
 * source/object ID use the ordinary cross-Project import planner. This returns
 * a candidate, not a write: the caller uses the existing Project Code commit.
 */
export function planProjectCellBodyImport(
  destination: CircuitProject,
  source: CircuitProject,
  sourceDocumentId: string,
  targetDocumentId: string,
  mode: "replace-body" | "append",
  identity: string,
): { project: CircuitProject; importedDocumentIds: string[] } {
  const target = destination.documents.find((d) => d.id === targetDocumentId);
  if (!target) throw new Error(`Target Cell not found: ${targetDocumentId}`);
  const plan = planProjectCellImport(
    destination,
    { ...source, id: identity },
    sourceDocumentId,
  );
  if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`);
  if (plan.status !== "ready")
    throw new Error("Candidate has already been imported");
  const imported = executeProjectTransaction(destination, {
    transactionId: "stage-cell-body",
    projectId: destination.id,
    expectedStructureRevision: destination.structureRevision,
    actor: { kind: "agent", id: "cell-import" },
    edits: [...plan.edits],
  });
  if (!imported.ok) throw new Error(imported.error.message);
  const root = imported.project.documents.find(
    (d) => d.id === plan.rootDocumentId,
  )!;
  const targetTerminals = target.netlist?.terminals ?? [];
  const sourceTerminals = root.netlist?.terminals ?? [];
  const called = destination.documents.some((d) =>
    d.instances.some(
      (i) =>
        i.netlist?.binding?.kind === "subcircuit" &&
        i.netlist.binding.childDocumentId === target.id,
    ),
  );
  const adoptInterface =
    mode === "replace-body" && !called && targetTerminals.length === 0;
  const mapping = new Map<string, string>([[root.id, target.id]]);
  const bind = (from: string, to: string) => {
    if (mapping.has(from) && mapping.get(from) !== to)
      throw new Error(
        "Formal terminals alias incompatible target Nets or owners",
      );
    mapping.set(from, to);
  };
  if (!adoptInterface) {
    if (
      mode === "replace-body" &&
      sourceTerminals.length !== targetTerminals.length
    )
      throw new Error(
        "Source and target Cell interfaces differ; declare the intended interface first",
      );
    for (const terminal of sourceTerminals) {
      const existing = targetTerminals.find(
        (t) => foldNetName(t.name) === foldNetName(terminal.name),
      );
      // Structural SPICE has passive/unspecified ports. Keep the destination's
      // authored direction; explicit conflicting directions remain an error.
      if (
        !existing ||
        (terminal.direction !== "passive" &&
          terminal.direction !== existing.direction)
      )
        throw new Error(`Formal terminal mismatch: ${terminal.name}`);
      bind(terminal.id, existing.id);
      if (mode === "append") {
        bind(terminal.netId, existing.netId);
        if (
          terminal.interfaceInstanceIds.length !==
            existing.interfaceInstanceIds.length ||
          Boolean(terminal.interfaceAnnotationId) !==
            Boolean(existing.interfaceAnnotationId)
        )
          throw new Error(`Incompatible interface owner for ${terminal.name}`);
        terminal.interfaceInstanceIds.forEach((id, index) =>
          bind(id, existing.interfaceInstanceIds[index]!),
        );
        if (terminal.interfaceAnnotationId)
          bind(terminal.interfaceAnnotationId, existing.interfaceAnnotationId!);
        // Carry routes to the retained marker, not a second formal Port.
        for (const label of root.annotations) {
          if (
            label.binding?.kind !== "cell-terminal-name" ||
            label.binding.terminalId !== terminal.id
          )
            continue;
          const old = target.annotations.find(
            (a) =>
              a.binding?.kind === "cell-terminal-name" &&
              a.binding.terminalId === existing.id,
          );
          if (old) bind(label.id, old.id);
        }
      }
    }
  }
  const targetParameters = target.netlist?.formalParameters ?? [];
  const sourceParameters = root.netlist?.formalParameters ?? [];
  if (
    !adoptInterface &&
    sourceParameters.some(
      (p) =>
        !targetParameters.some(
          (q) => q.name === p.name && q.defaultValue === p.defaultValue,
        ),
    )
  )
    throw new Error(
      "Source formal parameters are not declared compatibly in the target Cell",
    );
  if (mode === "append") {
    const targetNames = new Map(
      resolveDocumentLogicalNets(target)
        .groups.filter((n) => n.name)
        .map((n) => [foldNetName(n.name!), n]),
    );
    const logical = resolveDocumentLogicalNets(root);
    for (const net of logical.groups) {
      const old = net.name ? targetNames.get(foldNetName(net.name)) : undefined;
      if (!old) continue;
      const formal = net.baseNetIds.some(
        (id) => mapping.has(id) && old.baseNetIds.includes(mapping.get(id)!),
      );
      const sameGlobal =
        net.scope === "global" &&
        old.scope === "global" &&
        net.powerDomain === old.powerDomain;
      if (!formal && !sameGlobal)
        throw new Error(
          `Local Net name collision: ${net.name}; rename it before append`,
        );
    }
    for (const instance of root.instances) {
      const bulk = resolveMosBulkConnection(root, instance, logical);
      if (bulk?.status === "unresolved")
        throw new Error(
          `Resolve imported MOS bulk before append: ${instance.reference ?? instance.id}`,
        );
      if (bulk?.net) {
        instance.mosBulkBinding = {
          netId: bulk.net.id,
          origin: "instance-override",
        };
        if (
          !bulk.net.terminals.some(
            (t) => t.instanceId === instance.id && t.pinName === "B",
          )
        )
          bulk.net.terminals.push({ instanceId: instance.id, pinName: "B" });
      }
    }
    const references = new Set(
      target.instances.flatMap((i) =>
        i.reference ? [i.reference.toLowerCase()] : [],
      ),
    );
    for (const instance of root.instances) {
      if (
        !mapping.has(instance.id) &&
        instance.reference &&
        references.has(instance.reference.toLowerCase())
      )
        throw new Error(
          `Instance Reference collision: ${instance.reference}; rename it before append`,
        );
    }
  }
  const newIds = new Set(plan.importedDocumentIds);
  const remapped = imported.project.documents
    .filter((d) => newIds.has(d.id))
    .map((d) => remapImportedIdentifierValues(d, mapping) as SchematicDocument);
  let incoming = remapped.find((d) => d.id === target.id)!;
  const name = target.netlist?.name ?? target.name;
  incoming.name = target.name;
  if (incoming.netlist) incoming.netlist.name = name;
  if (incoming.sourceBinding) incoming.sourceBinding.cellName = name;
  for (const document of remapped)
    for (const instance of document.instances) {
      if (
        instance.netlist?.binding?.kind === "subcircuit" &&
        instance.netlist.binding.childDocumentId === target.id
      )
        instance.symbolId = hierarchicalSymbolId(name);
    }
  if (mode === "replace-body") {
    if (!adoptInterface && incoming.netlist)
      incoming.netlist = {
        ...incoming.netlist,
        formalParameters: targetParameters,
        terminals: targetTerminals.map((t) => ({
          ...incoming.netlist!.terminals.find((n) => n.id === t.id)!,
          id: t.id,
          name: t.name,
          direction: t.direction,
        })),
      };
    // The destination's symbol pin presentation remains valid because IDs and
    // order stay fixed. Internal drawing geometry is the imported body.
    incoming.presentation = {
      ...incoming.presentation,
      cellSymbol: target.presentation.cellSymbol,
    };
  } else {
    const append = <T extends { id: string }>(old: T[], added: T[]): T[] => {
      const ids = new Set(old.map((i) => i.id));
      return [...old, ...added.filter((i) => !ids.has(i.id))];
    };
    const nets = append(target.nets, incoming.nets).map((net) => {
      const extra = incoming.nets.find((n) => n.id === net.id);
      if (!extra || !target.nets.some((n) => n.id === net.id)) return net;
      return {
        ...net,
        terminals: [
          ...net.terminals,
          ...extra.terminals.filter(
            (t) =>
              !net.terminals.some(
                (q) => q.instanceId === t.instanceId && q.pinName === t.pinName,
              ),
          ),
        ],
      };
    });
    incoming = {
      ...target,
      instances: append(target.instances, incoming.instances),
      nets,
      routes: append(target.routes, incoming.routes),
      junctions: append(target.junctions, incoming.junctions),
      noConnects: append(target.noConnects, incoming.noConnects),
      annotations: append(target.annotations, incoming.annotations),
      connectivityEvidence: append(
        target.connectivityEvidence,
        incoming.connectivityEvidence,
      ),
      layoutGroups: append(target.layoutGroups, incoming.layoutGroups),
      constraints: append(target.constraints, incoming.constraints),
      drafting: {
        objects: append(
          target.drafting?.objects ?? [],
          incoming.drafting?.objects ?? [],
        ),
      },
      sourceStatus: "connectivity-modified",
    };
    // Adding a global supply must not silently resolve or retarget a previously
    // authored body's implicit substrate connection.
    for (const instance of target.instances) {
      const before = resolveMosBulkConnection(target, instance);
      if (!before) continue;
      const after = resolveMosBulkConnection(incoming, instance.id);
      if (
        before.net?.id !== after?.net?.id ||
        (before.status === "no-connect") !== (after?.status === "no-connect")
      )
        throw new Error(
          `Append changes existing MOS bulk: ${instance.reference ?? instance.id}; make the binding explicit first`,
        );
    }
  }
  const candidate = {
    ...imported.project,
    documents: [
      ...destination.documents.map((d) => (d.id === target.id ? incoming : d)),
      ...remapped.filter((d) => d.id !== target.id),
    ],
  };
  return {
    project: CircuitProjectSchema.parse(candidate),
    importedDocumentIds: remapped
      .filter((d) => d.id !== target.id)
      .map((d) => d.id),
  };
}
