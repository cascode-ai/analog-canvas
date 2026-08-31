import {
  createReferenceIndex,
  deviceDescriptor,
  referenceIssuesForInstance,
  type ReferenceIssue,
} from "@icm/devices";
import { type CircuitProject, type InstanceNetlistBinding } from "@icm/model";

import type { ProjectConnectivityIndex } from "./connectivity-index.js";
import { findHierarchyPaths } from "./hierarchy-navigation.js";
import {
  directObjectLocator,
  type HierarchyFrame,
  type ObjectLocator,
} from "./object-locator.js";

/** One definition-level row; caller paths are context, never duplicate rows. */
export interface ProjectInstanceRow {
  readonly key: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly instanceId: string;
  readonly reference?: string;
  readonly masterName?: string;
  readonly symbolId: string;
  readonly deviceClass?: string;
  readonly binding?: InstanceNetlistBinding;
  readonly parameters: Readonly<Record<string, string>>;
  readonly referenceIssues: readonly ReferenceIssue[];
  readonly locator: ObjectLocator & { readonly kind: "instance" };
  readonly callerPaths: readonly (readonly HierarchyFrame[])[];
}

export interface ProjectInstanceIndex {
  readonly rows: readonly ProjectInstanceRow[];
  row(documentId: string, instanceId: string): ProjectInstanceRow | undefined;
  search(query: string): readonly ProjectInstanceRow[];
}

function rowMatches(row: ProjectInstanceRow, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    row.documentName,
    row.documentId,
    row.instanceId,
    row.reference,
    row.masterName,
    row.symbolId,
    row.deviceClass,
    row.binding?.kind,
    ...(row.binding?.kind === "model" ? [row.binding.name] : []),
    ...Object.entries(row.parameters).flatMap(([name, value]) => [name, value]),
  ].some((value) => value?.toLowerCase().includes(normalized));
}

function masterNameFor(
  project: CircuitProject,
  binding: InstanceNetlistBinding | undefined,
): string | undefined {
  if (!binding) return undefined;
  switch (binding.kind) {
    case "model":
    case "unresolved-subcircuit":
      return binding.name;
    case "external-subcircuit":
      return project.externalSubcircuitDefinitions.find(
        (definition) => definition.id === binding.definitionId,
      )?.name;
    case "subcircuit":
      return project.documents.find(
        (document) => document.id === binding.childDocumentId,
      )?.netlist?.name;
    case "primitive":
      return binding.deviceClass;
  }
}

/**
 * Read-only project projection used by the future table and batch planner.
 * It deliberately does not fold in presentation annotations or callers as
 * separate rows: a child Cell remains one editable definition.
 */
export function buildProjectInstanceIndex(
  project: CircuitProject,
  options: { connectivityIndex?: ProjectConnectivityIndex } = {},
): ProjectInstanceIndex {
  const rows = project.documents
    .flatMap((document) => {
      const references = createReferenceIndex(document);
      const callerPaths = options.connectivityIndex
        ? (findHierarchyPaths(
            options.connectivityIndex,
            project.topDocumentId,
            document.id,
          ) ?? [])
        : [];
      return document.instances.map((instance): ProjectInstanceRow => {
        const descriptor = deviceDescriptor(instance.symbolId);
        const masterName = masterNameFor(project, instance.netlist?.binding);
        return {
          key: `${document.id}\u0000${instance.id}`,
          documentId: document.id,
          documentName: document.netlist?.name ?? document.name,
          instanceId: instance.id,
          ...(instance.reference ? { reference: instance.reference } : {}),
          ...(masterName ? { masterName } : {}),
          symbolId: instance.symbolId,
          ...(descriptor ? { deviceClass: descriptor.deviceClass } : {}),
          ...(instance.netlist?.binding
            ? { binding: structuredClone(instance.netlist.binding) }
            : {}),
          parameters: structuredClone(instance.netlist?.parameters ?? {}),
          referenceIssues: referenceIssuesForInstance(references, instance.id),
          locator: directObjectLocator(document.id, "instance", instance.id),
          callerPaths,
        };
      });
    })
    .sort(
      (left, right) =>
        left.documentName.localeCompare(right.documentName, "en") ||
        (left.reference ?? left.instanceId).localeCompare(
          right.reference ?? right.instanceId,
          "en",
          { sensitivity: "base" },
        ) ||
        left.instanceId.localeCompare(right.instanceId, "en"),
    );
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return {
    rows,
    row(documentId, instanceId) {
      return byKey.get(`${documentId}\u0000${instanceId}`);
    },
    search(query) {
      return rows.filter((row) => rowMatches(row, query));
    },
  };
}
