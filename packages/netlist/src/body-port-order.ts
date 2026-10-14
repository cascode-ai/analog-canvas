import type { StableId } from "@icm/model";

import { generatedBehavioralDefinition } from "./generated-models.js";
import { IDEAL_CHOPPER_TARGET } from "./ideal-switch-model.js";
import type { DesignNetlistInstance, DesignNetlistIR } from "./ir.js";

/**
 * A subcircuit body the netlist writes itself — a generated behavioral model,
 * a magnetic network or a generated model Cell — with the Instances calling it.
 */
export interface GeneratedBody {
  name: string;
  /** Its ports in the order the netlist prints them by default. */
  ports: readonly string[];
  /** The Instances that call it, in IR order. */
  instanceIds: readonly StableId[];
}

/** The order to print a body's ports in, a permutation of its own; null keeps it. */
export type BodyPortOrder = (body: GeneratedBody) => readonly string[] | null;

/**
 * The IR with bodies the netlist writes itself printed with their ports in
 * another order, and every call of them reordered alike, so a call's node i
 * still meets the body's port i and the file stays the same circuit. A
 * notation that binds symbols to terminal positions (RNL) reads such a file
 * in its own terminal order.
 *
 * Only generated bodies move: Cells the author drew and external masters keep
 * their interface, and so does the chopper, whose SPICE body is written by
 * hand. The IR passed in is not changed.
 */
export function withBodyPortOrder(
  ir: DesignNetlistIR,
  order: BodyPortOrder,
): DesignNetlistIR {
  const next = structuredClone(ir);
  const callers = (name: string): DesignNetlistInstance[] =>
    next.cells.flatMap((cell) =>
      cell.instances.filter(
        (instance) =>
          instance.invocationKind === "subcircuit" && instance.target === name,
      ),
    );
  const reorder = (
    name: string,
    ports: readonly string[],
    setPorts: (ports: readonly string[]) => void,
  ) => {
    const calls = callers(name);
    const wanted = order({
      name,
      ports,
      instanceIds: calls.map((call) => call.id),
    });
    if (
      !wanted ||
      (wanted.length === ports.length &&
        wanted.every((port, index) => port === ports[index]))
    )
      return;
    const from = wanted.map((port) => ports.indexOf(port));
    if (
      wanted.length !== ports.length ||
      from.some((index) => index < 0) ||
      new Set(wanted).size !== wanted.length
    )
      throw new Error(
        `Port order ${wanted.join(" ")} is not a reordering of ${name}'s ports ${ports.join(" ")}`,
      );
    for (const call of calls) {
      if (call.nodes.length !== ports.length)
        throw new Error(
          `${call.reference} calls ${name} with ${call.nodes.length} nodes for ${ports.length} ports`,
        );
      const nodes = call.nodes;
      call.nodes = from.map((index) => nodes[index]!);
    }
    setPorts(wanted);
  };
  for (const definition of next.generatedDefinitions ?? []) {
    if (definition.kind === "magnetic")
      reorder(definition.name, definition.ports, (ports) => {
        definition.ports = [...ports];
      });
    else if (definition.name !== IDEAL_CHOPPER_TARGET)
      reorder(
        definition.name,
        generatedBehavioralDefinition(definition.name).ports,
        (ports) => {
          definition.ports = [...ports];
        },
      );
  }
  for (const cell of next.cells) {
    if (cell.origin !== "generated-model") continue;
    reorder(
      cell.name,
      cell.ports.map((port) => port.name),
      (ports) => {
        cell.ports = ports.map((name) =>
          cell.ports.find((port) => port.name === name)!,
        );
      },
    );
  }
  return next;
}
