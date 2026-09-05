export interface Schema39To40MigrationReport {
  readonly changed: boolean;
  readonly migratedProbeIds: readonly string[];
  readonly baseNetProbeIds: readonly string[];
}

export interface Schema39To40MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema39To40MigrationReport;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function voltageAnchor(
  project: Record<string, unknown>,
  documentId: string,
  netId: string,
): Record<string, unknown> | undefined {
  const document = Array.isArray(project.documents)
    ? project.documents
        .map(record)
        .find((candidate) => candidate?.id === documentId)
    : undefined;
  if (!document) return undefined;
  const net = Array.isArray(document.nets)
    ? document.nets.map(record).find((candidate) => candidate?.id === netId)
    : undefined;
  const terminal = Array.isArray(net?.terminals)
    ? net.terminals
        .map(record)
        .find(
          (candidate) =>
            typeof candidate?.instanceId === "string" &&
            typeof candidate.pinName === "string",
        )
    : undefined;
  if (terminal)
    return {
      kind: "terminal",
      instanceId: terminal.instanceId,
      pinName: terminal.pinName,
    };
  const junction = Array.isArray(document.junctions)
    ? document.junctions
        .map(record)
        .find(
          (candidate) =>
            candidate?.netId === netId && typeof candidate.id === "string",
        )
    : undefined;
  if (junction) return { kind: "junction", junctionId: junction.id };
  const route = Array.isArray(document.routes)
    ? document.routes
        .map(record)
        .find(
          (candidate) =>
            candidate?.netId === netId && typeof candidate.id === "string",
        )
    : undefined;
  return route ? { kind: "route", routeId: route.id } : undefined;
}

/** Upgrade saved Net representatives to concrete voltage-probe anchors. */
export function upgradeSchema39To40WithReport(
  raw: Record<string, unknown>,
): Schema39To40MigrationResult {
  const project = structuredClone(raw);
  const migratedProbeIds: string[] = [];
  const baseNetProbeIds: string[] = [];
  const simulation = record(project.simulation);
  const input = record(simulation?.input);
  if (input?.kind === "structured" && Array.isArray(input.probes)) {
    input.probes = input.probes.flatMap((value) => {
      const probe = record(value);
      if (
        probe?.kind !== "net-voltage" ||
        typeof probe.id !== "string" ||
        typeof probe.documentId !== "string" ||
        typeof probe.netId !== "string"
      )
        return [value];
      const anchor = voltageAnchor(project, probe.documentId, probe.netId);
      if (!anchor) {
        probe.anchor = { kind: "base-net", netId: probe.netId };
        delete probe.netId;
        baseNetProbeIds.push(probe.id);
        return [probe];
      }
      delete probe.netId;
      probe.anchor = anchor;
      migratedProbeIds.push(probe.id);
      return [probe];
    });
  }
  project.schemaVersion = 40;
  return {
    project,
    report: {
      changed: migratedProbeIds.length > 0 || baseNetProbeIds.length > 0,
      migratedProbeIds,
      baseNetProbeIds,
    },
  };
}

export function upgradeSchema39To40(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema39To40WithReport(raw).project;
}
