export interface Schema33To34MigrationReport {
  readonly migratedImportedNameHints: number;
  readonly migratedLegacyNameHints: number;
  readonly materializedGlobalDeclarations: number;
  readonly materializedPowerOwners: number;
  readonly changed: boolean;
}

export interface Schema33To34MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema33To34MigrationReport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function powerOwnerId(
  document: Record<string, unknown>,
  netId: string,
): string | undefined {
  const routes = Array.isArray(document.routes) ? document.routes : [];
  const powerRoute = routes.find(
    (route) =>
      isRecord(route) &&
      route.netId === netId &&
      route.presentation === "power-rail" &&
      typeof route.id === "string",
  );
  if (isRecord(powerRoute) && typeof powerRoute.id === "string") {
    return powerRoute.id;
  }
  const annotations = Array.isArray(document.annotations)
    ? document.annotations
    : [];
  const powerLabel = annotations.find(
    (annotation) =>
      isRecord(annotation) &&
      annotation.netId === netId &&
      annotation.kind === "power-label" &&
      typeof annotation.id === "string",
  );
  if (isRecord(powerLabel) && typeof powerLabel.id === "string") {
    return powerLabel.id;
  }
  const nets = Array.isArray(document.nets) ? document.nets : [];
  const net = nets.find(
    (candidate) => isRecord(candidate) && candidate.id === netId,
  );
  const terminals =
    isRecord(net) && Array.isArray(net.terminals) ? net.terminals : [];
  const markerInstanceIds = new Set(
    (Array.isArray(document.instances) ? document.instances : []).flatMap(
      (instance) =>
        isRecord(instance) &&
        typeof instance.id === "string" &&
        (instance.symbolId === "ground" || instance.symbolId === "vdd-port")
          ? [instance.id]
          : [],
    ),
  );
  const markerTerminal = terminals.find(
    (terminal) =>
      isRecord(terminal) &&
      typeof terminal.instanceId === "string" &&
      markerInstanceIds.has(terminal.instanceId),
  );
  return isRecord(markerTerminal) &&
    typeof markerTerminal.instanceId === "string"
    ? markerTerminal.instanceId
    : undefined;
}

/**
 * Schema 34 retires hidden electrical name claims. Imported local spellings
 * become non-electrical round-trip hints; explicit SPICE globals retain their
 * electrical authority through their source declaration, and visible power
 * presentation becomes the owner when an older Project relied on a shadow
 * property for a power rail or marker.
 */
export function upgradeSchema33To34WithReport(
  raw: Record<string, unknown>,
): Schema33To34MigrationResult {
  const project = structuredClone(raw);
  let migratedImportedNameHints = 0;
  let migratedLegacyNameHints = 0;
  let materializedGlobalDeclarations = 0;
  let materializedPowerOwners = 0;
  const documents = Array.isArray(project.documents) ? project.documents : [];
  for (const document of documents) {
    if (!isRecord(document) || !Array.isArray(document.connectivityEvidence)) {
      continue;
    }
    const sourceIdsByNet = new Map<string, string[]>();
    for (const evidence of document.connectivityEvidence) {
      if (
        isRecord(evidence) &&
        evidence.kind === "spice-source" &&
        typeof evidence.netId === "string" &&
        typeof evidence.sourceNetId === "string"
      ) {
        const ids = sourceIdsByNet.get(evidence.netId) ?? [];
        ids.push(evidence.sourceNetId);
        sourceIdsByNet.set(evidence.netId, ids);
      }
    }
    document.connectivityEvidence = document.connectivityEvidence.map(
      (evidence) => {
        if (
          !isRecord(evidence) ||
          evidence.kind !== "name-claim" ||
          !isRecord(evidence.owner) ||
          evidence.owner.kind !== "explicit-net-property" ||
          typeof evidence.netId !== "string" ||
          typeof evidence.name !== "string"
        ) {
          return evidence;
        }
        const ownerId = powerOwnerId(document, evidence.netId);
        if (ownerId) {
          materializedPowerOwners += 1;
          return {
            ...evidence,
            owner: { kind: "power-marker", objectId: ownerId },
          };
        }
        const sourceNetIds = [
          ...new Set(sourceIdsByNet.get(evidence.netId) ?? []),
        ].sort();
        if (evidence.scope === "global" && sourceNetIds[0]) {
          materializedGlobalDeclarations += 1;
          return {
            ...evidence,
            owner: {
              kind: "global-declaration",
              sourceNetId: sourceNetIds[0],
            },
          };
        }
        const imported = sourceNetIds.length > 0;
        if (imported) migratedImportedNameHints += 1;
        else migratedLegacyNameHints += 1;
        return {
          id: evidence.id,
          kind: "net-name-hint",
          netId: evidence.netId,
          sourceName: evidence.name,
          origin: imported ? "spice-import" : "legacy-explicit-net-property",
        };
      },
    );
  }
  project.schemaVersion = 34;
  const changed =
    migratedImportedNameHints > 0 ||
    migratedLegacyNameHints > 0 ||
    materializedGlobalDeclarations > 0 ||
    materializedPowerOwners > 0;
  return {
    project,
    report: {
      migratedImportedNameHints,
      migratedLegacyNameHints,
      materializedGlobalDeclarations,
      materializedPowerOwners,
      changed,
    },
  };
}

export function upgradeSchema33To34(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema33To34WithReport(raw).project;
}
