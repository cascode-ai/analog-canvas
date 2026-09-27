import type { DesignNetlistCell } from "./ir.js";
import { deriveStableId } from "@icm/model";
import {
  instrumentCellTerminalCurrents,
  instrumentationKey,
  type TerminalCurrentInstrumentation,
} from "./terminal-current-instrumentation.js";

export function lowerTerminalCurrentControls(cell: DesignNetlistCell) {
  const probes = new Map<string, TerminalCurrentInstrumentation>();
  const issues: { instanceId: string; targetId: string; message: string }[] =
    [];
  if (!cell.instances.some((instance) => instance.controlTerminal))
    return { cell, issues };
  const occupied = new Set(
    [
      ...cell.instances.map((item) => item.reference),
      ...cell.instances.flatMap((item) =>
        item.nodes.map((node) => node.netName),
      ),
      ...cell.nets.map((net) => net.name),
    ].map((name) => name.toLowerCase()),
  );
  for (const source of cell.instances) {
    const control = source.controlTerminal;
    if (!control) continue;
    const target = cell.instances.find(
      (item) => item.id === control.instanceId,
    );
    const node = target?.nodes.find(
      (item) => (item.canvasPinName ?? item.pinName) === control.pinName,
    );
    const reject = (message: string) =>
      issues.push({
        instanceId: source.id,
        targetId: control.instanceId,
        message,
      });
    if (!target || !node || node.netName.startsWith("<unconnected:")) {
      reject(
        `Control terminal ${control.instanceId}.${control.pinName} is missing or not electrically connected in this Cell`,
      );
      continue;
    }
    source.controlCurrentSign = control.direction === "out" ? -1 : 1;
    if (
      target.deviceClass === "voltage-source" &&
      target.invocationKind === "primitive" &&
      ["+", "-"].includes(control.pinName)
    ) {
      source.controlSourceInstanceId = target.id;
      if (control.pinName === "-")
        source.controlCurrentSign = source.controlCurrentSign === 1 ? -1 : 1;
      continue;
    }
    const key = instrumentationKey({
      cellId: cell.id,
      instanceId: target.id,
      pinName: node.pinName,
    });
    let probe = probes.get(key);
    if (!probe) {
      // Reuse the repository's bounded identity allocator. A long authored ID
      // must still export an importable reference (at most 128 characters).
      // Collisions are diagnosed, never resolved by order-dependent rebinding.
      const suffix = deriveStableId(
        "sense",
        cell.id,
        target.id,
        node.pinName,
      ).slice("sense-".length);
      probe = {
        cellId: cell.id,
        instanceId: target.id,
        pinName: node.pinName,
        senseReference: `V__icm_sense_${suffix}`,
        senseNode: `__icm_sense_node_${suffix}`,
      };
      if (
        occupied.has(probe.senseReference.toLowerCase()) ||
        occupied.has(probe.senseNode.toLowerCase())
      ) {
        reject(
          `Generated current probe collides with an authored name for ${target.reference}.${control.pinName}`,
        );
        continue;
      }
      probes.set(key, probe);
      occupied.add(probe.senseReference.toLowerCase());
      occupied.add(probe.senseNode.toLowerCase());
    }
    source.controlSourceInstanceId = `${target.id}:simulation-current-sense:${probe.senseReference}`;
  }
  return { cell: instrumentCellTerminalCurrents(cell, probes), issues };
}

export function signedControlGain(
  raw: string,
  sign: 1 | -1 | undefined,
  format: "spice" | "spectre",
): string {
  if (sign !== -1) return raw;
  const trimmed = raw.trim();
  const expression =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;
  return format === "spice" ? `{ -(${expression}) }` : `(-(${expression}))`;
}
