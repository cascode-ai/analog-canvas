import type {
  CircuitProject,
  SimulationSourceInput,
  SimulationSourceExpression,
} from "@icm/model";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { simulationSignals } from "./simulation-signal-names.js";
import { ngspiceSignals } from "./simulation-ngspice-signal-names.js";
import { vacaskIdentifier } from "./vacask-printer.js";

/** Resolve the existing durable anchor; no new persisted acquisition identity. */
export function resolveSimulationVoltageProbeNetId(
  project: CircuitProject,
  target: Pick<
    Extract<SimulationSourceExpression, { kind: "voltage" }>,
    "kind" | "documentId" | "anchor" | "occurrence"
  >,
): string | undefined {
  const document = project.documents.find((d) => d.id === target.documentId);
  if (!document) return undefined;
  const anchor = target.anchor;
  if (anchor.kind === "terminal")
    return document.nets.find((net) =>
      net.terminals.some(
        (t) =>
          t.instanceId === anchor.instanceId && t.pinName === anchor.pinName,
      ),
    )?.id;
  if (anchor.kind === "junction")
    return document.junctions.find((j) => j.id === anchor.junctionId)?.netId;
  if (anchor.kind === "route")
    return document.routes.find((r) => r.id === anchor.routeId)?.netId;
  return document.nets.find((net) => net.id === anchor.netId)?.id;
}

/** GUI and API resolve the same scoped electrical target, never a display label
 * or a temporary JSON output compiled by the retired execution pipeline. */
export function nativeVoltageAcquisition(
  project: CircuitProject,
  input: SimulationSourceInput,
  target: Extract<SimulationSourceExpression, { kind: "voltage" }>,
  engine: "ngspice" | "vacask" = "vacask",
) {
  const document = project.documents.find((d) => d.id === target.documentId);
  const netId = resolveSimulationVoltageProbeNetId(project, target);
  if (!document || !netId)
    return {
      ok: false as const,
      message: "The selected voltage anchor no longer belongs to a Net",
    };
  const logical = resolveDocumentLogicalNets(document).byBaseNetId;
  const net = logical.get(netId)?.id;
  const candidates = Object.entries(
    (engine === "ngspice" ? ngspiceSignals : simulationSignals)(
      project,
      input,
      target.circuit,
    ),
  ).filter(([, signal]) =>
    signal.targets.some(
      (t) =>
        t.documentId === target.documentId &&
        JSON.stringify(t.occurrence) === JSON.stringify(target.occurrence) &&
        (net === undefined
          ? t.netId === netId
          : logical.get(t.netId)?.id === net),
    ),
  );
  if (candidates.length !== 1)
    return {
      ok: false as const,
      message:
        "The selected Net has no unique reachable native occurrence; choose its exact DUT call path",
    };
  const vector = candidates[0]![0];
  return {
    ok: true as const,
    vector,
    save: engine === "ngspice" ? vector : `v(${vacaskIdentifier(vector)})`,
  };
}
