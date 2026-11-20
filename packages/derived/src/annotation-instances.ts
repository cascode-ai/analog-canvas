import {
  isFrozenSnapshot,
  type Instance,
  type SchematicDocument,
} from "@icm/model";

interface AnnotationOwners {
  firstById: Map<string, Instance>;
  unplacedIds: Set<string>;
}

const ownersByInstances = new WeakMap<readonly Instance[], AnnotationOwners>();

/** Only snapshot-owned arrays and their entries are immutable across reads. */
function frozenOwners(instances: Instance[]): AnnotationOwners | undefined {
  if (!isFrozenSnapshot(instances)) return undefined;
  let owners = ownersByInstances.get(instances);
  if (!owners) {
    owners = { firstById: new Map(), unplacedIds: new Set() };
    for (const instance of instances) {
      if (!owners.firstById.has(instance.id))
        owners.firstById.set(instance.id, instance);
      if (instance.placement === null) owners.unplacedIds.add(instance.id);
    }
    ownersByInstances.set(instances, owners);
  }
  return owners;
}

export function annotationInstance(
  document: SchematicDocument,
  id: string,
): Instance | undefined {
  const owners = frozenOwners(document.instances);
  return owners
    ? owners.firstById.get(id)
    : document.instances.find((instance) => instance.id === id);
}

export function hasUnplacedAnnotationOwner(
  document: SchematicDocument,
  id: string,
): boolean {
  const owners = frozenOwners(document.instances);
  return owners
    ? owners.unplacedIds.has(id)
    : document.instances.some(
        (instance) => instance.id === id && instance.placement === null,
      );
}
