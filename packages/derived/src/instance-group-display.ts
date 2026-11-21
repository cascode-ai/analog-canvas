import {
  routeEndpoints,
  type InstanceGroup,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";

/** Collapsing a group changes ink and hit targets, never its electrical graph. */
export function instanceGroupDisplay(document: SchematicDocument):
  | {
      representatives: ReadonlyMap<string, InstanceGroup>;
      hidden: ReadonlySet<string>;
    }
  | undefined {
  if (!document.instanceGroups?.some((group) => group.collapsed)) return;
  const placed = new Set(
    document.instances.filter((part) => part.placement).map(({ id }) => id),
  );
  const representatives = new Map<string, InstanceGroup>();
  const hidden = new Set<string>();
  for (const group of document.instanceGroups) {
    const [first, ...rest] = group.memberIds;
    if (!group.collapsed || !first || !placed.has(first)) continue;
    representatives.set(first, group);
    for (const id of rest) hidden.add(id);
  }
  if (!representatives.size) return;
  for (const junction of document.junctions)
    if (junction.contactAnchor && hidden.has(junction.contactAnchor.instanceId))
      hidden.add(junction.id);
  const hiddenEndpoint = (endpoint: RouteEndpoint) =>
    hidden.has(
      endpoint.kind === "terminal" ? endpoint.instanceId : endpoint.junctionId,
    );
  for (const route of document.routes)
    if (routeEndpoints(route).some(hiddenEndpoint)) hidden.add(route.id);
  for (const { id, anchor, binding } of document.annotations)
    if (
      (anchor.kind === "object" && hidden.has(anchor.objectId)) ||
      (binding && "instanceId" in binding && hidden.has(binding.instanceId))
    )
      hidden.add(id);
  for (const mark of document.noConnects)
    if (hidden.has(mark.endpoint.instanceId)) hidden.add(mark.id);
  for (const coupling of document.inductorCouplings ?? [])
    if (coupling.members.some(({ instanceId }) => hidden.has(instanceId)))
      hidden.add(coupling.id);
  return { representatives, hidden };
}

/** Intersect the paint and hit-test crop with the authored group view. */
export function instanceGroupVisibleIds(
  document: SchematicDocument,
  hidden: ReadonlySet<string> | undefined,
  crop?: ReadonlySet<string> | null,
): ReadonlySet<string> | undefined {
  if (!hidden?.size) return crop ?? undefined;
  const ids =
    crop ??
    [
      ...document.instances,
      ...document.routes,
      ...document.junctions,
      ...document.annotations,
      ...document.noConnects,
      ...(document.drafting?.objects ?? []),
      ...(document.inductorCouplings ?? []),
    ].map(({ id }) => id);
  return new Set([...ids].filter((id) => !hidden.has(id)));
}
