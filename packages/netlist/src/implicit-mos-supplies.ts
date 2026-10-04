import {
  deriveStableId,
  type CircuitProject,
  type Net,
  type SchematicDocument,
} from "@icm/model";
import {
  drawnSupplyNet,
  drawsSupply,
  mosBulkKind,
  portableCellIdentifier,
  resolveMosBulkConnection,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import { subcircuitDescriptor } from "@icm/devices";
import type { DesignNetlistAnalysisOptions } from "./extract.js";
import { idealAnalogBlockCell } from "./ideal-analog-block-models.js";
import type { NetlistFormat } from "./net-name-codec.js";

/**
 * The built-in bodies that never read VDD or VSS: the ideal amplifiers and
 * the adder in either format, and the multiplier in SPICE. An authored Cell
 * or a declared external definition of the same name replaces the body, and
 * may well use its supplies.
 */
export function bodyIgnoresSupplies(
  target: string,
  project: CircuitProject,
  cellNames: Iterable<string>,
  format: NetlistFormat,
): boolean {
  const folded = target.toLowerCase();
  if (
    [...cellNames].some((name) => name.toLowerCase() === folded) ||
    project.externalSubcircuitDefinitions.some(
      (definition) => definition.name.toLowerCase() === folded,
    )
  )
    return false;
  return (
    idealAnalogBlockCell(target, format) !== null ||
    (format === "spice" && target === "multiplier")
  );
}

/**
 * The hidden VDD/VSS terminals of Analog Blocks whose body reads them, in a
 * Cell that neither binds them nor draws any supply of that domain. They take
 * the default an unconnected MOS body takes. A Cell that drew several
 * supplies of a domain is asked to choose instead.
 */
function blockSuppliesToDefault(
  source: CircuitProject,
  options: DesignNetlistAnalysisOptions,
): { documentId: string; instanceId: string; supply: "VDD" | "VSS" }[] {
  const cellNames = source.documents.flatMap((document) =>
    document.netlist?.name
      ? [portableCellIdentifier(document.netlist.name, document.id)]
      : [],
  );
  return source.documents.flatMap((document) => {
    let logical: ReturnType<typeof resolveDocumentLogicalNets> | undefined;
    const drawn = new Map<"vdd" | "ground", boolean>();
    const domainDrawn = (domain: "vdd" | "ground") => {
      logical ??= resolveDocumentLogicalNets(document);
      if (!drawn.has(domain))
        drawn.set(domain, drawsSupply(document, domain, logical));
      return drawn.get(domain)!;
    };
    return document.instances.flatMap((instance) => {
      const descriptor = subcircuitDescriptor(instance.symbolId, source);
      if (!descriptor) return [];
      const binding = instance.netlist?.binding;
      const target =
        binding?.kind === "unresolved-subcircuit"
          ? binding.name
          : descriptor.target;
      if (
        bodyIgnoresSupplies(
          target,
          source,
          cellNames,
          options.format ?? "spice",
        )
      )
        return [];
      return descriptor.ports.flatMap((port) => {
        const supply = port.supply;
        if (!supply) return [];
        const bound = document.nets.some((net) =>
          net.terminals.some(
            (pin) => pin.instanceId === instance.id && pin.pinName === supply,
          ),
        );
        if (bound || domainDrawn(supply === "VDD" ? "vdd" : "ground"))
          return [];
        return [{ documentId: document.id, instanceId: instance.id, supply }];
      });
    });
  });
}

/** A read-only electrical projection for schematic MOS bodies with no authored
 * connection. Supply symbols are not required to express the default substrate.
 * Existing body wiring, Cell defaults and explicit NoConnect remain authoritative.
 */
export function withImplicitMosSupplies(
  source: CircuitProject,
  options: DesignNetlistAnalysisOptions,
): CircuitProject {
  const blockSupplies = blockSuppliesToDefault(source, options);
  const missing = source.documents.flatMap((document) => {
    const logical = resolveDocumentLogicalNets(document);
    return document.instances.flatMap((instance) =>
      mosBulkKind(instance) &&
      resolveMosBulkConnection(document, instance, logical)?.status ===
        "unresolved"
        ? [{ documentId: document.id, instanceId: instance.id }]
        : [],
    );
  });
  if (!missing.length && !blockSupplies.length) return source;
  const project = structuredClone(source);
  const addedVddPorts = new Set<string>();
  const supplies = new Map<string, { nmos: Net; pmos: Net }>();
  function supply(document: SchematicDocument, positive: boolean): Net {
    const logical = resolveDocumentLogicalNets(document);
    const drawn = drawnSupplyNet(
      document,
      positive ? "vdd" : "ground",
      logical,
    );
    if (drawn) return drawn;
    const name = positive ? "VDD" : "0";
    // Reuse an unambiguous authored conventional name. Never collapse two
    // differently scoped Nets merely because they spell the same supply.
    const named = logical.groups.filter(
      (group) => group.name?.toUpperCase() === (positive ? "VDD" : "VSS"),
    );
    if (named.length === 1 && !named[0]!.conflicts.length)
      return document.nets.find((net) =>
        named[0]!.baseNetIds.includes(net.id),
      )!;
    const netId = deriveStableId("netlist-default-supply", document.id, name);
    const ownerId = deriveStableId(
      "netlist-default-supply-owner",
      document.id,
      name,
    );
    const net: Net = {
      id: netId,
      terminals: [{ instanceId: ownerId, pinName: positive ? "P" : "0" }],
    };
    document.nets.push(net);
    document.instances.push({
      id: ownerId,
      symbolId: positive ? "vdd-port" : "ground",
      placement: null,
    });
    const formal =
      positive &&
      options.groundPin === "pin" &&
      !(options.rootAsTopLevel && document.id === options.rootDocumentId) &&
      document.netlist;
    if (formal) {
      formal.terminals.unshift({
        id: `${ownerId}-port`,
        name,
        netId,
        direction: "inout",
        interfaceInstanceIds: [ownerId],
      });
      addedVddPorts.add(document.id);
    } else {
      document.connectivityEvidence.push({
        id: `${ownerId}-claim`,
        kind: "name-claim",
        netId,
        name,
        scope: "global",
        powerDomain: positive ? "vdd" : "ground",
        owner: { kind: "power-marker", objectId: ownerId },
      });
    }
    return net;
  }
  function defaults(document: SchematicDocument) {
    let result = supplies.get(document.id);
    if (!result) {
      result = { pmos: supply(document, true), nmos: supply(document, false) };
      supplies.set(document.id, result);
    }
    return result;
  }
  for (const item of missing) {
    const document = project.documents.find((d) => d.id === item.documentId)!;
    const instance = document.instances.find((i) => i.id === item.instanceId)!;
    const kind = mosBulkKind(instance)!;
    const configuredId =
      kind === "nmos"
        ? document.mosBulkDefaults?.nmosNetId
        : document.mosBulkDefaults?.pmosNetId;
    const net =
      document.nets.find((candidate) => candidate.id === configuredId) ??
      defaults(document)[kind];
    // An unresolved policy-owned orphan can still carry stale B membership.
    for (const candidate of document.nets)
      candidate.terminals = candidate.terminals.filter(
        (pin) => pin.instanceId !== instance.id || pin.pinName !== "B",
      );
    net.terminals.push({ instanceId: instance.id, pinName: "B" });
  }
  for (const item of blockSupplies) {
    const document = project.documents.find((d) => d.id === item.documentId)!;
    const supplies = defaults(document);
    (item.supply === "VDD" ? supplies.pmos : supplies.nmos).terminals.push({
      instanceId: item.instanceId,
      pinName: item.supply,
    });
  }
  // A newly exposed supply belongs on both sides of an internal Cell call.
  // Ground propagation is handled by the existing VSS interface projection.
  let changed = true;
  while (changed) {
    changed = false;
    for (const document of project.documents) {
      for (const instance of [...document.instances]) {
        const binding = instance.netlist?.binding;
        if (
          binding?.kind !== "subcircuit" ||
          !supplies.has(binding.childDocumentId)
        )
          continue;
        const alreadyHasDefaults = supplies.has(document.id);
        const callerSupplies = defaults(document);
        if (!alreadyHasDefaults) changed = true;
        if (!addedVddPorts.has(binding.childDocumentId)) continue;
        if (
          document.nets.some((net) =>
            net.terminals.some(
              (pin) => pin.instanceId === instance.id && pin.pinName === "VDD",
            ),
          )
        )
          continue;
        callerSupplies.pmos.terminals.push({
          instanceId: instance.id,
          pinName: "VDD",
        });
        changed = true;
      }
    }
  }
  return project;
}
