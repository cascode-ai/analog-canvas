import {
  deriveRoutingAffectedClosure,
  endpointKey,
  type RoutingAffectedClosure,
  type RoutingSelectionSeed,
} from "@icm/derived";
import type { SchematicDocument } from "@icm/model";

export interface RoutingCopyCapture {
  readonly affected: RoutingAffectedClosure;
  readonly internalNetIds: readonly string[];
  readonly ownerNetIds: readonly string[];
  readonly clonedNetIds: readonly string[];
  readonly boundaryTerminalKeys: readonly string[];
}

export interface RoutingCopyCaptureOptions {
  readonly includeImplicitInstanceRoutes?: boolean;
}

function stable(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

/**
 * Capture the electrical portion of C copy-placement. Boundary Routes are
 * deliberately absent. Named owners (formal Ports, supply markers and
 * selected Net labels) retain their own name-bearing Base Net so their clone
 * can rejoin a Logical Net by name rather than by a physical source-Net ID.
 */
export function captureRoutingCopyFragment(
  document: SchematicDocument,
  seed: RoutingSelectionSeed,
  options: RoutingCopyCaptureOptions = {},
): RoutingCopyCapture {
  const affected = deriveRoutingAffectedClosure(document, seed, options);
  const selectedInstances = new Set(affected.instances);
  const selectedAnnotations = new Set([
    ...(seed.annotationIds ?? []),
    ...affected.electricalAnnotationIds,
  ]);
  const internalNetIds = stable(
    document.nets.flatMap((net) =>
      options.includeImplicitInstanceRoutes !== false &&
      net.terminals.length > 0 &&
      net.terminals.every((terminal) =>
        selectedInstances.has(terminal.instanceId),
      )
        ? [net.id]
        : affected.internalRoutes.some(
              (routeId) =>
                document.routes.find((route) => route.id === routeId)?.netId ===
                net.id,
            )
          ? [net.id]
          : [],
    ),
  );
  const ownerNetIds = stable([
    ...(document.netlist?.terminals.flatMap((terminal) =>
      terminal.interfaceInstanceIds.some((id) => selectedInstances.has(id))
        ? [terminal.netId]
        : [],
    ) ?? []),
    ...document.connectivityEvidence.flatMap((evidence) => {
      if (evidence.kind !== "name-claim") return [];
      if (
        evidence.owner.kind === "power-marker" &&
        selectedInstances.has(evidence.owner.objectId)
      ) {
        return [evidence.netId];
      }
      if (
        evidence.owner.kind === "net-label" &&
        selectedAnnotations.has(evidence.owner.annotationId)
      ) {
        return [evidence.netId];
      }
      return [];
    }),
  ]);
  const clonedNetIds = stable([...internalNetIds, ...ownerNetIds]);
  const clonedNets = new Set(clonedNetIds);
  const boundaryTerminalKeys = stable(
    document.nets.flatMap((net) =>
      clonedNets.has(net.id)
        ? []
        : net.terminals
            .filter((terminal) => selectedInstances.has(terminal.instanceId))
            .map((terminal) => endpointKey({ kind: "terminal", ...terminal })),
    ),
  );
  return {
    affected,
    internalNetIds,
    ownerNetIds,
    clonedNetIds,
    boundaryTerminalKeys,
  };
}
