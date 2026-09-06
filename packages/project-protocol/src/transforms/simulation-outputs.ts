export interface Schema42To43MigrationReport {
  readonly changed: boolean;
  readonly migratedOutputIds: readonly string[];
}

export interface Schema42To43MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema42To43MigrationReport;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function identifierLabel(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  const candidate = normalized || fallback;
  return /^[A-Za-z_]/u.test(candidate) ? candidate : `Output_${candidate}`;
}

function uniqueLabel(
  requested: string,
  fallback: string,
  used: Set<string>,
): string {
  const base = identifierLabel(requested, fallback).slice(0, 128);
  let candidate = base;
  for (let suffix = 2; used.has(candidate.toLowerCase()); suffix += 1) {
    const ending = `_${suffix}`;
    candidate = `${base.slice(0, 128 - ending.length)}${ending}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function voltageBaseNetId(
  document: Record<string, unknown>,
  anchor: Record<string, unknown>,
): string | undefined {
  if (anchor.kind === "base-net" && typeof anchor.netId === "string")
    return anchor.netId;
  if (anchor.kind === "junction" && typeof anchor.junctionId === "string")
    return record(
      array(document.junctions).find(
        (value) => record(value)?.id === anchor.junctionId,
      ),
    )?.netId as string | undefined;
  if (anchor.kind === "route" && typeof anchor.routeId === "string")
    return record(
      array(document.routes).find(
        (value) => record(value)?.id === anchor.routeId,
      ),
    )?.netId as string | undefined;
  if (
    anchor.kind === "terminal" &&
    typeof anchor.instanceId === "string" &&
    typeof anchor.pinName === "string"
  ) {
    for (const netValue of array(document.nets)) {
      const net = record(netValue);
      if (
        typeof net?.id === "string" &&
        array(net.terminals).some((terminalValue) => {
          const terminal = record(terminalValue);
          return (
            terminal?.instanceId === anchor.instanceId &&
            terminal?.pinName === anchor.pinName
          );
        })
      )
        return net.id;
    }
  }
  return undefined;
}

/**
 * Derive an initial authored label from the same electrical identities the
 * editor presents. The result is copied into `output.label`; it is not a
 * second display-name protocol and may be renamed independently afterwards.
 */
function migratedProbeLabel(
  project: Record<string, unknown>,
  probe: Record<string, unknown>,
): string {
  const document = array(project.documents)
    .map(record)
    .find((candidate) => candidate?.id === probe.documentId);
  if (!document) return String(probe.id);

  if (probe.kind === "source-current" && typeof probe.instanceId === "string") {
    const instance = array(document.instances)
      .map(record)
      .find((candidate) => candidate?.id === probe.instanceId);
    const reference =
      typeof instance?.reference === "string"
        ? instance.reference
        : probe.instanceId;
    return `${reference}_current`;
  }

  const anchor = record(probe.anchor);
  if (probe.kind !== "net-voltage" || !anchor) return String(probe.id);
  const netId = voltageBaseNetId(document, anchor);
  if (!netId) return String(probe.id);

  const nameClaim = array(document.connectivityEvidence)
    .map(record)
    .find(
      (evidence) =>
        evidence?.kind === "name-claim" &&
        evidence.netId === netId &&
        typeof evidence.name === "string",
    );
  if (typeof nameClaim?.name === "string") return nameClaim.name;

  const netlist = record(document.netlist);
  const formalTerminal = array(netlist?.terminals)
    .map(record)
    .find(
      (terminal) =>
        terminal?.netId === netId && typeof terminal.name === "string",
    );
  if (typeof formalTerminal?.name === "string") return formalTerminal.name;

  const endpoint = array(document.nets)
    .map(record)
    .find((net) => net?.id === netId);
  const terminal = record(array(endpoint?.terminals)[0]);
  if (
    typeof terminal?.instanceId === "string" &&
    typeof terminal.pinName === "string"
  ) {
    const instance = array(document.instances)
      .map(record)
      .find((candidate) => candidate?.id === terminal.instanceId);
    const netlist = record(instance?.netlist);
    const binding = record(netlist?.binding);
    if (binding?.kind === "subcircuit") return terminal.pinName;
    const reference =
      typeof instance?.reference === "string"
        ? instance.reference
        : terminal.instanceId;
    return `${reference}_${terminal.pinName}`;
  }
  return String(probe.id);
}

/** Replace persisted primitive probes with the canonical output-expression form. */
export function upgradeSchema42To43WithReport(
  raw: Record<string, unknown>,
): Schema42To43MigrationResult {
  const project = structuredClone(raw);
  const migratedOutputIds: string[] = [];
  let changed = false;
  const setups = Array.isArray(project.simulationSetups)
    ? project.simulationSetups
    : [];
  for (const value of setups) {
    const setup = record(value);
    const input = record(setup?.input);
    if (!setup) continue;
    setup.version = 2;
    changed = true;
    if (input?.kind === "structured" && Array.isArray(input.probes)) {
      const usedLabels = new Set<string>();
      input.outputs = input.probes.map((probeValue) => {
        const probe = record(probeValue);
        if (!probe || typeof probe.id !== "string") return probeValue;
        migratedOutputIds.push(probe.id);
        const expression = { ...probe };
        delete expression.id;
        expression.kind =
          expression.kind === "net-voltage" ? "voltage" : "current";
        return {
          id: probe.id,
          label: uniqueLabel(
            migratedProbeLabel(project, probe),
            probe.id,
            usedLabels,
          ),
          expression,
        };
      });
      delete input.probes;
    }
  }
  project.schemaVersion = 43;
  return {
    project,
    report: {
      changed,
      migratedOutputIds,
    },
  };
}

export function upgradeSchema42To43(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema42To43WithReport(raw).project;
}
