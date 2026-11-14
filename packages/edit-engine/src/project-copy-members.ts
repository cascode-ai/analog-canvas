import {
  deriveStableId,
  routeEnd,
  type CircuitProject,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";

/** This table is scoped by Document and declaration: equal old member strings
 * on a migrated stub and its former Cell Pin are different identities.
 */
export type CopiedMemberIds = Record<
  string,
  Record<string, Record<string, string>>
>;

export function copyCallerArtwork(
  component: NonNullable<CircuitProject["componentDefinitions"]>[number],
  child: SchematicDocument,
  mapping: CopiedMemberIds,
  options: { keepSymbolId?: boolean } = {},
): NonNullable<CircuitProject["componentDefinitions"]>[number] {
  const copy = structuredClone(component);
  for (const pin of copy.symbol.pins) {
    const formal = child.netlist?.terminals.find(
      (terminal) => terminal.name === pin.name,
    );
    if (!formal || !pin.signalMembers) continue;
    pin.signalMembers = pin.signalMembers.map((member) => ({
      ...member,
      id: mapping[child.id]?.[formal.id]?.[member.id] ?? member.id,
    }));
  }
  if (
    options.keepSymbolId ||
    JSON.stringify(copy) === JSON.stringify(component)
  )
    return copy;
  const id = deriveStableId(
    "copied-caller-symbol",
    component.symbol.id,
    JSON.stringify(copy.symbol.pins),
  );
  copy.symbol.id = id;
  if (copy.electrical) copy.electrical.symbolId = id;
  if (copy.subcircuit) copy.subcircuit.symbolId = id;
  return copy;
}

export function allocateCopiedMemberIds(
  documents: readonly SchematicDocument[],
  objectId: (id: string) => string,
): CopiedMemberIds {
  return Object.fromEntries(
    documents.map((document) => [
      document.id,
      Object.fromEntries(
        [
          ...(document.netlist?.terminals ?? []).map(
            (terminal) => [terminal.id, terminal.signal?.members] as const,
          ),
          ...document.junctions.map(
            (junction) => [junction.id, junction.members] as const,
          ),
          ...document.routes.map((route) => [route.id, route.members] as const),
          ...document.connectivityEvidence.flatMap((evidence) =>
            evidence.kind === "name-claim"
              ? [[evidence.id, evidence.signal?.members] as const]
              : [],
          ),
        ].map(([owner, members]) => [
          owner,
          Object.fromEntries(
            (members ?? []).map((member) => [
              member.id,
              deriveStableId(
                "copy-member",
                document.id,
                objectId(owner),
                member.id,
              ),
            ]),
          ),
        ]),
      ),
    ]),
  );
}

export function copiedEndpointMember(
  document: SchematicDocument,
  documents: readonly SchematicDocument[],
  mapping: CopiedMemberIds,
  endpoint: RouteEndpoint,
): string | undefined {
  if (!endpoint.memberId) return undefined;
  if (endpoint.kind === "junction")
    return (
      mapping[document.id]?.[endpoint.junctionId]?.[endpoint.memberId] ??
      endpoint.memberId
    );
  const local = document.netlist?.terminals.find((terminal) =>
    terminal.interfaceInstanceIds.includes(endpoint.instanceId),
  );
  if (local)
    return (
      mapping[document.id]?.[local.id]?.[endpoint.memberId] ?? endpoint.memberId
    );
  const binding = document.instances.find(
    (instance) => instance.id === endpoint.instanceId,
  )?.netlist?.binding;
  if (binding?.kind !== "subcircuit") return endpoint.memberId;
  const child = documents.find((item) => item.id === binding.childDocumentId);
  const formal = child?.netlist?.terminals.find(
    (terminal) => terminal.name === endpoint.pinName,
  );
  return child && formal
    ? (mapping[child.id]?.[formal.id]?.[endpoint.memberId] ?? endpoint.memberId)
    : endpoint.memberId;
}

/** Complete the member references after the existing structural import map. */
export function remapImportedMembers(
  source: SchematicDocument,
  target: SchematicDocument,
  project: Pick<CircuitProject, "documents">,
  mapping: CopiedMemberIds,
  netId: (id: string) => string,
): void {
  const member = (owner: string, id: string) =>
    mapping[source.id]![owner]![id]!;
  const endpoint = (from: RouteEndpoint, to: RouteEndpoint) => {
    if (from.memberId)
      to.memberId = copiedEndpointMember(
        source,
        project.documents,
        mapping,
        from,
      )!;
  };
  source.netlist?.terminals.forEach((terminal, index) => {
    const signal = target.netlist!.terminals[index]!.signal;
    if (signal)
      signal.members = terminal.signal!.members.map((item) => ({
        ...item,
        id: member(terminal.id, item.id),
        netId: netId(item.netId),
      }));
  });
  source.junctions.forEach((junction, index) => {
    if (junction.members)
      target.junctions[index]!.members = junction.members.map((item) => ({
        ...item,
        id: member(junction.id, item.id),
        netId: netId(item.netId),
      }));
    if (junction.contactAnchor?.memberId)
      target.junctions[index]!.contactAnchor!.memberId = copiedEndpointMember(
        source,
        project.documents,
        mapping,
        { kind: "terminal", ...junction.contactAnchor },
      )!;
  });
  source.connectivityEvidence.forEach((evidence, index) => {
    const copied = target.connectivityEvidence[index]!;
    if (
      evidence.kind === "name-claim" &&
      evidence.signal &&
      copied.kind === "name-claim"
    )
      copied.signal = {
        ...evidence.signal,
        members: evidence.signal.members.map((item) => ({
          ...item,
          id: member(evidence.id, item.id),
          netId: netId(item.netId),
        })),
      };
  });
  source.routes.forEach((route, index) => {
    const copied = target.routes[index]!;
    endpoint(route.start, copied.start);
    endpoint(routeEnd(route), routeEnd(copied));
    if (route.members)
      copied.members = route.members.map((lane) => {
        const claim = source.connectivityEvidence.find(
          (evidence) =>
            evidence.kind === "name-claim" &&
            evidence.signal?.members.some(
              (item) => item.id === lane.id && item.netId === lane.netId,
            ),
        );
        return {
          ...lane,
          id: member(claim?.id ?? route.id, lane.id),
          netId: netId(lane.netId),
          startMemberId: copiedEndpointMember(
            source,
            project.documents,
            mapping,
            { ...route.start, memberId: lane.startMemberId },
          )!,
          endMemberId: copiedEndpointMember(
            source,
            project.documents,
            mapping,
            { ...routeEnd(route), memberId: lane.endMemberId },
          )!,
        };
      });
  });
  source.nets.forEach((net, index) =>
    net.terminals.forEach((terminal, terminalIndex) => {
      if (terminal.memberId)
        target.nets[index]!.terminals[terminalIndex]!.memberId =
          copiedEndpointMember(source, project.documents, mapping, {
            kind: "terminal",
            ...terminal,
          })!;
    }),
  );
  source.annotations.forEach((annotation, index) => {
    const binding = annotation.binding;
    const copied = target.annotations[index]!.binding;
    if (binding?.kind !== "net-name" || copied?.kind !== "net-name") return;
    if (binding.memberEndpoint && copied.memberEndpoint)
      endpoint(binding.memberEndpoint, copied.memberEndpoint);
    binding.memberEndpoints?.forEach((item, endpointIndex) =>
      endpoint(item, copied.memberEndpoints![endpointIndex]!),
    );
  });
  source.noConnects.forEach((item, index) =>
    endpoint(item.endpoint, target.noConnects[index]!.endpoint),
  );
}
