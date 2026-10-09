#!/usr/bin/env node

/** Build a strict, PyAether-friendly import manifest from Gallery projects. */

import fs from "node:fs";
import { withNativeNames } from "./analog-canvas-aether-names.mjs";
import { assertSupportedHierarchy } from "./analog-canvas-aether-bindings.mjs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  analyzeDesignNetlist,
  createDesignNetlistExport,
} from "@icm/netlist";
import {
  parseProject,
} from "@icm/project-protocol";
import {
  resolveEndpointPoint,
} from "@icm/derived";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "@icm/symbols";

const { values: options } = parseArgs({
  options: {
    "snapshot-export": { type: "string" },
    output: { type: "string" },
    library: { type: "string" },
    "source-commit": { type: "string" },
    "spacing-factor": { type: "string", default: "1.5" },
    "skip-unsupported": { type: "boolean", default: false },
    "expand-inverters": { type: "boolean", default: false },
    circuit: { type: "string", multiple: true },
  },
});
if (!options["snapshot-export"] || !options.output || !options.library || !options.circuit?.length) {
  throw new Error("Require --snapshot-export, --output, --library and at least one --circuit ID:CELL");
}
const OUTPUT = path.resolve(options.output);
const LIBRARY = options.library;
if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(LIBRARY)) {
  throw new Error("Invalid Aether library name");
}
const spacingFactor = Number(options["spacing-factor"]);
if (!Number.isFinite(spacingFactor) || spacingFactor <= 0) {
  throw new Error("spacing-factor must be finite and positive");
}

const selection = options.circuit.map((value) => {
      const match = /^([A-Za-z0-9][A-Za-z0-9_-]*):([A-Za-z][A-Za-z0-9_]*)$/u.exec(value);
      if (!match) throw new Error(`Invalid circuit selection: ${value}`);
      return [match[1], match[2]];
    });
unique(selection.map((item) => item[0]), "Gallery selections");
unique(selection.map((item) => item[1]), "target cell names");

function targetDirection() {
  return "inout";
}

function asParameters(parameters) {
  return Object.fromEntries(
    parameters.map((item) => [item.name, item.rawValue]),
  );
}

function unique(values, context) {
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate ${context}: ${values.join(", ")}`);
  }
}

function mosKind(target) {
  return {
    NMOS: "nmos", PMOS: "pmos",
    nch_ulvt_mac: "nmos", pch_ulvt_mac: "pmos",
    sky130_fd_pr__nfet_01v8: "nmos", sky130_fd_pr__pfet_01v8: "pmos",
  }[target] ?? null;
}

function mappedNodes(instance, pinMap) {
  const sourcePins = instance.nodes.map((node) => node.pinName).sort();
  const expectedPins = Object.keys(pinMap).sort();
  if (JSON.stringify(sourcePins) !== JSON.stringify(expectedPins)) {
    throw new Error(
      `${instance.reference} pins ${sourcePins.join("/")} do not match ${expectedPins.join("/")}`,
    );
  }
  return instance.nodes.map((node) => ({
    sourcePinName: node.canvasPinName ?? node.pinName,
    pinName: pinMap[node.pinName],
    netName: node.netName,
  }));
}

function passivePinMap(instance, positive, negative) {
  const pins = instance.nodes.map((node) => node.pinName).sort();
  for (const pair of [["1", "2"], ["P1", "P2"]]) {
    if (JSON.stringify(pins) === JSON.stringify(pair)) {
      return { [pair[0]]: positive, [pair[1]]: negative };
    }
  }
  throw new Error(`${instance.reference}: unsupported passive terminals ${pins.join("/")}`);
}

function targetDevice(
  instance,
  sourceInstance,
  { deviceClass, targetLibrary, targetCell, pinMap, kind = null, offset = {} },
) {
  const position = sourceInstance.placement.position;
  return {
    id: instance.id,
    reference: instance.reference,
    deviceClass,
    ...(kind ? { kind } : {}),
    sourceTarget: instance.target,
    sourceInvocationKind: instance.invocationKind,
    targetLibrary,
    targetCell,
    sourcePosition: {
      x: position.x + (offset.x ?? 0),
      y: position.y + (offset.y ?? 0),
    },
    sourceTransform: {
      rotation: sourceInstance.placement.rotation,
      mirror: sourceInstance.placement.mirror,
    },
    nodes: mappedNodes(instance, pinMap),
    sourceParameters: asParameters(instance.parameters),
    // Reviewed SKY130 IR projects geometry to plain micrometre numbers.
    sourceLengthUnit: instance.reviewedExternalBindingId ? "um" : "m",
    sourceReviewedBinding: instance.reviewedExternalBindingId ?? null,
  };
}

function normalizeInstance(galleryId, instance, sourceInstance) {
  if (!sourceInstance?.placement) {
    throw new Error(`${galleryId}:${instance.reference} has no placement`);
  }
  if (instance.deviceClass === "hierarchical" && instance.target === "inverter") {
    if (!options["expand-inverters"]) {
      throw new Error(`${galleryId}:${instance.reference}: use --expand-inverters to opt into the fixed CMOS expansion profile`);
    }
    const nets = Object.fromEntries(instance.nodes.map((node) => [node.pinName, node.netName]));
    for (const pin of ["VDD", "VSS", "A", "Y"]) {
      if (!nets[pin]) throw new Error(`${galleryId}:${instance.reference} misses ${pin}`);
    }
    const placement = sourceInstance.placement;
    const makeMos = (kind, suffix, dy) => {
      if (["vertical", "both"].includes(placement.mirror)) dy = -dy;
      const angle = placement.rotation * Math.PI / 180;
      return {
        id: `${instance.id}:${suffix}`, reference: `${instance.reference}_${suffix}`,
        deviceClass: "mos", kind, sourceTarget: "inverter",
        sourceInvocationKind: "expanded-subcircuit", sourceExpandedFrom: instance.reference,
        sourceExpandedInstanceId: instance.id,
        expansionProfile: "cmos-inverter-w1u-l150n-v1",
        sourceBehavioralParameters: asParameters(instance.parameters),
        targetLibrary: "hes", targetCell: kind === "pmos" ? "p_mos_a" : "n_mos_a",
        sourcePosition: { x: placement.position.x - Math.round(dy * Math.sin(angle)), y: placement.position.y + Math.round(dy * Math.cos(angle)) },
        sourceTransform: { rotation: placement.rotation, mirror: placement.mirror },
        nodes: [
          { sourcePinName: "Y", pinName: "D", netName: nets.Y },
          { sourcePinName: "A", pinName: "G", netName: nets.A },
          ...["S", "B"].map((pinName) => ({ sourcePinName: kind === "pmos" ? "VDD" : "VSS", pinName, netName: kind === "pmos" ? nets.VDD : nets.VSS })),
        ],
        sourceParameters: { w: "1u", l: "150n", nf: "1", m: "1" },
        sourceLengthUnit: "m",
      };
    };
    return [makeMos("pmos", "P", -10), makeMos("nmos", "N", 10)];
  }

  const kind = mosKind(instance.target);
  if (instance.deviceClass === "mos" || (instance.deviceClass === "hierarchical" && kind)) {
    if (!kind) {
      throw new Error(`${galleryId}:${instance.reference} unknown MOS ${instance.target}`);
    }
    return [
      targetDevice(instance, sourceInstance, {
        deviceClass: "mos",
        kind,
        targetLibrary: "hes",
        targetCell: kind === "pmos" ? "p_mos_a" : "n_mos_a",
        pinMap: { D: "D", G: "G", S: "S", B: "B" },
      }),
    ];
  }
  if (instance.deviceClass === "capacitor") {
    return [
      targetDevice(instance, sourceInstance, {
        deviceClass: "capacitor",
        targetLibrary: "analog",
        targetCell: "cap",
        pinMap: passivePinMap(instance, "P", "N"),
      }),
    ];
  }
  if (instance.deviceClass === "resistor") {
    return [
      targetDevice(instance, sourceInstance, {
        deviceClass: "resistor",
        targetLibrary: "analog",
        targetCell: "res",
        pinMap: passivePinMap(instance, "P", "N"),
      }),
    ];
  }
  if (instance.deviceClass === "inductor") {
    return [targetDevice(instance, sourceInstance, {
      deviceClass: "inductor", targetLibrary: "analog", targetCell: "ind",
      pinMap: passivePinMap(instance, "P", "N"),
    })];
  }
  if (["current-source", "voltage-source"].includes(instance.deviceClass)) {
    const parameters = asParameters(instance.parameters);
    const targetCell = instance.deviceClass === "current-source" ? "idc" : "vdc";
    if (parameters.waveform && parameters.waveform !== "dc") {
      throw new Error(`${galleryId}:${instance.reference}: analog/${targetCell} cannot represent waveform ${parameters.waveform}`);
    }
    return [
      targetDevice(instance, sourceInstance, {
        deviceClass: instance.deviceClass,
        targetLibrary: "analog",
        targetCell,
        pinMap: { "+": "P", "-": "N" },
      }),
    ];
  }
  throw new Error(
    `${galleryId}:${instance.reference} unsupported ${instance.invocationKind}:${instance.deviceClass}:${instance.target}`,
  );
}

function normalizeEndpoint(endpoint) {
  if (endpoint.kind === "terminal") {
    return {
      kind: "terminal",
      instanceId: endpoint.instanceId,
      pinName: endpoint.pinName,
    };
  }
  if (endpoint.kind === "junction") {
    return { kind: "junction", junctionId: endpoint.junctionId };
  }
  throw new Error(`Unsupported route endpoint ${JSON.stringify(endpoint)}`);
}

function rawEndpoint(endpoint) {
  if (endpoint.terminal) {
    return {
      kind: "terminal",
      instanceId: endpoint.terminal[0],
      pinName: endpoint.terminal[1],
    };
  }
  if (endpoint.junction) {
    return { kind: "junction", junctionId: endpoint.junction };
  }
  throw new Error(`Unsupported raw endpoint ${JSON.stringify(endpoint)}`);
}

function canonicalNetMap(source, cell) {
  const result = new Map([
    ...cell.nets.map((net) => [net.id, net.name]),
    ...cell.ports.map((port) => [port.id, port.netName]),
  ]);
  const canonicalPortsByName = new Map(
    cell.ports.map((port) => [port.name, port.netName]),
  );
  const sourceTerminalByInstance = new Map();
  for (const terminal of source.netlist?.terminals ?? []) {
    const netName = canonicalPortsByName.get(terminal.name);
    if (netName) result.set(terminal.netId, netName);
    for (const instanceId of terminal.interfaceInstanceIds ?? []) {
      sourceTerminalByInstance.set(instanceId, terminal);
    }
  }

  const analysisInstances = new Map(cell.instances.map((item) => [item.id, item]));
  for (const sourceNet of source.nets) {
    const candidates = new Set();
    const direct = result.get(sourceNet.id);
    if (direct) candidates.add(direct);
    for (const terminalRef of sourceNet.terminals ?? []) {
      const analysisInstance = analysisInstances.get(terminalRef.instanceId);
      const analysisNode = analysisInstance?.nodes.find(
        (node) => (node.canvasPinName ?? node.pinName) === terminalRef.pinName,
      );
      if (analysisNode) candidates.add(analysisNode.netName);
      const interfaceTerminal = sourceTerminalByInstance.get(terminalRef.instanceId);
      const interfaceNet = interfaceTerminal
        ? canonicalPortsByName.get(interfaceTerminal.name)
        : null;
      if (interfaceNet) candidates.add(interfaceNet);
    }
    if (candidates.size > 1) {
      throw new Error(
        `${cell.name}:${sourceNet.id} maps to conflicting nets ${[...candidates].join(", ")}`,
      );
    }
    if (candidates.size === 1) result.set(sourceNet.id, [...candidates][0]);
  }
  return { result, sourceTerminalByInstance };
}

function buildSourceGeometry(
  source,
  rawSource,
  cell,
  instances,
  ports,
  nets,
  resolver,
) {
  const netSet = new Set(nets);
  const { result: canonicalByNetId, sourceTerminalByInstance } =
    canonicalNetMap(source, cell);
  const canonicalPortsByName = new Map(ports.map((port) => [port.name, port]));
  const sourceInstances = new Map(source.instances.map((item) => [item.id, item]));
  const sourceNetsByTerminal = new Map();
  for (const sourceNet of source.nets) {
    for (const terminal of sourceNet.terminals ?? []) {
      sourceNetsByTerminal.set(
        `${terminal.instanceId}:${terminal.pinName}`,
        sourceNet.id,
      );
    }
  }

  function endpointNetName(endpoint) {
    if (endpoint.kind === "junction") {
      const junction = source.junctions.find(
        (item) => item.id === endpoint.junctionId,
      );
      return junction ? canonicalByNetId.get(junction.netId) : null;
    }
    const analysisInstance = cell.instances.find(
      (item) => item.id === endpoint.instanceId,
    );
    const node = analysisInstance?.nodes.find(
      (item) => (item.canvasPinName ?? item.pinName) === endpoint.pinName,
    );
    if (node) return node.netName;
    const interfaceTerminal = sourceTerminalByInstance.get(endpoint.instanceId);
    if (interfaceTerminal) {
      return canonicalPortsByName.get(interfaceTerminal.name)?.netName ?? null;
    }
    const sourceNetId = sourceNetsByTerminal.get(
      `${endpoint.instanceId}:${endpoint.pinName}`,
    );
    return sourceNetId ? canonicalByNetId.get(sourceNetId) : null;
  }

  function exactSourcePoint(endpoint) {
    const point = resolveEndpointPoint(source, resolver, endpoint);
    if (!point) {
      throw new Error(
        `${cell.name}: cannot resolve exact source point for ${JSON.stringify(endpoint)}`,
      );
    }
    return point;
  }

  function exactEndpoint(endpoint) {
    const normalized = normalizeEndpoint(endpoint);
    return { ...normalized, sourcePoint: exactSourcePoint(normalized) };
  }

  const portOccurrences = [];
  const internalNetMarkers = [];
  const omittedResidualMarkers = [];
  const annotationStubs = [];
  const sourcePortSymbols = new Set(["port", "port-filled", "vdd-port", "ground"]);
  for (const sourceInstance of source.instances) {
    if (!sourcePortSymbols.has(sourceInstance.symbolId)) continue;
    const terminalRefs = source.nets.flatMap((net) =>
      (net.terminals ?? []).filter(
        (terminal) => terminal.instanceId === sourceInstance.id,
      ),
    );
    if (terminalRefs.length !== 1) {
      throw new Error(
        `${cell.name}:${sourceInstance.id} expected one exact port terminal, got ${terminalRefs.length}`,
      );
    }
    const contactPoint = exactSourcePoint({
      kind: "terminal",
      instanceId: sourceInstance.id,
      pinName: terminalRefs[0].pinName,
    });
    const interfaceTerminal = sourceTerminalByInstance.get(sourceInstance.id);
    let port = interfaceTerminal
      ? canonicalPortsByName.get(interfaceTerminal.name)
      : null;
    if (!port) {
      const sourceNetId = sourceNetsByTerminal.get(`${sourceInstance.id}:0`)
        ?? sourceNetsByTerminal.get(`${sourceInstance.id}:P`);
      const netName = sourceNetId ? canonicalByNetId.get(sourceNetId) : null;
      port = ports.find((item) => item.netName === netName);
    }
    if (!port) {
      const netName = endpointNetName({kind: "terminal", instanceId: sourceInstance.id,
                                      pinName: terminalRefs[0].pinName});
      if (!netSet.has(netName)) {
        const sourceNetId = sourceNetsByTerminal.get(`${sourceInstance.id}:${terminalRefs[0].pinName}`);
        const sourceNet = source.nets.find((net) => net.id === sourceNetId);
        const hasElectricalDevice = sourceNet?.terminals.some((terminal) =>
          cell.instances.some((instance) => instance.id === terminal.instanceId));
        if (!cell.nets.some((net) => net.name === netName) && (!sourceNet || hasElectricalDevice)) {
          throw new Error(`${cell.name}:${sourceInstance.id} has no canonical marker net`);
        }
        omittedResidualMarkers.push({occurrenceId: sourceInstance.id, netName: netName ?? null, sourceNetId,
          reason: "No electrical device or circuit port on this residual source net"});
        continue;
      }
      // A graphical supply marker need not be a top-level circuit port.
      internalNetMarkers.push({occurrenceId: sourceInstance.id, netName,
        sourceSymbolId: sourceInstance.symbolId, sourcePosition: contactPoint});
      continue;
    }
    portOccurrences.push({
      occurrenceId: sourceInstance.id,
      name: port.name,
      netName: port.netName,
      direction: port.direction,
      sourceSymbolId: sourceInstance.symbolId,
      sourcePosition: contactPoint,
      sourceTransform: {
        rotation: sourceInstance.placement.rotation,
        mirror: sourceInstance.placement.mirror,
      },
      synthesized: false,
    });
  }

  const sourceTerminalsById = new Map(
    (source.netlist?.terminals ?? []).map((terminal) => [terminal.id, terminal]),
  );
  const sourceJunctionsById = new Map(
    source.junctions.map((junction) => [junction.id, junction]),
  );
  const suppressedBoundPortAnnotations = [];
  for (const annotation of source.annotations ?? []) {
    if (!["power-label", "net-label"].includes(annotation.kind)) continue;
    const terminal = annotation.bind?.kind === "cell-terminal-name"
      ? sourceTerminalsById.get(annotation.bind.terminalId)
      : null;
    const annotatedNetName = annotation.netId
      ? canonicalByNetId.get(annotation.netId)
      : null;
    const port = terminal
      ? canonicalPortsByName.get(terminal.name)
      : ports.find((item) => item.netName === annotatedNetName);
    if (!port) continue;

    const anchor = annotation.anchor ?? {};
    const anchoredInstance = anchor.kind === "object"
      ? sourceInstances.get(anchor.objectId)
      : null;
    if (anchoredInstance && sourcePortSymbols.has(anchoredInstance.symbolId)) {
      suppressedBoundPortAnnotations.push({
        annotationId: annotation.id,
        anchoredPortInstanceId: anchoredInstance.id,
        sourceSymbolId: anchoredInstance.symbolId,
        name: port.name,
        netName: port.netName,
      });
      continue;
    }
    const anchoredJunction = anchor.kind === "object"
      ? sourceJunctionsById.get(anchor.objectId)
      : null;
    const anchorPosition = anchoredJunction?.position ?? anchor.fallbackPosition;
    if (!anchorPosition) continue;
    const fallbackX = anchor.fallbackPosition?.x;
    const outwardX = Number.isFinite(fallbackX) && fallbackX !== anchorPosition.x
      ? Math.sign(fallbackX - anchorPosition.x)
      : annotation.alignment === "end" ? -1 : 1;
    const sourcePosition = {
      x: anchorPosition.x + 20 * (outwardX || 1),
      y: anchorPosition.y,
    };
    portOccurrences.push({
      occurrenceId: annotation.id,
      name: port.name,
      netName: port.netName,
      direction: port.direction,
      sourceSymbolId: annotation.kind,
      sourcePosition,
      sourceTransform: {
        rotation: 0,
        mirror: outwardX >= 0 ? "horizontal" : "none",
      },
      sourceAnnotationId: annotation.id,
      synthesized: false,
    });
    annotationStubs.push({
      annotationId: annotation.id,
      netName: port.netName,
      anchorJunctionId: anchoredJunction?.id ?? null,
      start: anchorPosition,
      end: sourcePosition,
    });
  }

  const points = [
    ...source.instances.map((item) => item.placement.position),
    ...source.junctions.map((item) => item.position),
    ...portOccurrences.map((item) => item.sourcePosition),
    ...source.routes.flatMap((route) =>
      route.legs
        .filter((leg) => leg.to.kind === "bend")
        .map((leg) => leg.to.position),
    ),
  ];
  const bounds = {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
  const occurrenceNames = new Set(portOccurrences.map((item) => item.name));
  const logicalOnlyPorts = ports.filter((port) => !occurrenceNames.has(port.name));

  const routes = source.routes.flatMap((route) => {
    const netName = canonicalByNetId.get(route.netId);
    if (!netSet.has(netName)) return [];
    return [{
      id: route.id,
      netName,
      presentation: route.presentation ?? "signal",
      start: exactEndpoint(route.start),
      steps: route.legs.map((leg) => {
        if (leg.to.kind === "bend") {
          return {
            kind: "bend",
            bendId: leg.to.bendId,
            position: leg.to.position,
          };
        }
        if (leg.to.kind === "endpoint") {
          return exactEndpoint(leg.to.endpoint);
        }
        throw new Error(`${cell.name}:${route.id} has unsupported route leg`);
      }),
    }];
  });

  const contacts = (rawSource.connections?.contacts ?? []).flatMap(
    (group, index) => {
      const endpoints = group.map(rawEndpoint).map((endpoint) => ({
        ...endpoint,
        sourcePoint: exactSourcePoint(endpoint),
      }));
      const names = new Set(endpoints.map(endpointNetName).filter(Boolean));
      if (names.size > 1) {
        throw new Error(
          `${cell.name}:contact-${index} crosses nets ${[...names].join(", ")}`,
        );
      }
      const netName = [...names][0];
      return netSet.has(netName)
        ? [{ id: `contact-${index}`, netName, endpoints }]
        : [];
    },
  );

  const junctions = source.junctions.flatMap((junction) => {
    const netName = canonicalByNetId.get(junction.netId);
    return netSet.has(netName)
      ? [{
          id: junction.id,
          netName,
          sourcePosition: junction.position,
          role: junction.role ?? "branch",
        }]
      : [];
  });

  const portByNetName = new Map(ports.map((port) => [port.netName, port]));
  const localBulkLabels = [];
  const localBulkShorts = [];
  for (const instance of instances) {
    if (instance.deviceClass !== "mos") continue;
    const bulk = instance.nodes.find((node) => node.pinName === "B");
    const sourceNode = instance.nodes.find((node) => node.pinName === "S");
    const port = bulk ? portByNetName.get(bulk.netName) : null;
    if (!bulk || !port || !/^(VDD|VSS|VCC|GND|VPWR|VGND|VDDH|VDDL)$/iu.test(port.name)) {
      continue;
    }
    if (sourceNode?.netName === bulk.netName) {
      localBulkShorts.push({
        reference: instance.reference,
        bulkPinName: "B",
        sourcePinName: "S",
        netName: bulk.netName,
      });
      continue;
    }
    localBulkLabels.push({
      reference: instance.reference,
      pinName: "B",
      name: port.name,
      netName: port.netName,
      direction: port.direction,
    });
  }

  for (const route of routes) {
    const endpointNames = [route.start, ...route.steps]
      .filter((item) => item.kind !== "bend")
      .map(endpointNetName)
      .filter(Boolean);
    if (endpointNames.some((name) => name !== route.netName)) {
      throw new Error(`${cell.name}:${route.id} endpoint/net mismatch`);
    }
  }
  return {
    coordinateSystem: "Analog Canvas source coordinates (x right, y down)",
    bounds,
    portOccurrences,
    internalNetMarkers,
    omittedResidualMarkers,
    logicalOnlyPorts,
    routes,
    contacts,
    junctions,
    annotationStubs,
    suppressedBoundPortAnnotations,
    localBulkLabels,
    localBulkShorts,
    logicalOnlyGroups: rawSource.connections?.unrouted?.length ?? 0,
    sourceRouteCount: source.routes.length,
    retainedRouteCount: routes.length,
    targetDeviceCount: instances.length,
  };
}

function buildCircuit(galleryId, cellName) {
  const snapshotDirectory = path.join(options["snapshot-export"], "circuits", galleryId);
  const detailPath = path.join(snapshotDirectory, "entry.json");
  const metadata = JSON.parse(fs.readFileSync(detailPath, "utf8"));
  if (!metadata.formats?.spice?.qualified || metadata.id !== galleryId) {
    throw new Error(`${galleryId} is not a qualified snapshot SPICE export`);
  }
  const detail = {
        entry: metadata,
        projectText: fs.readFileSync(path.join(snapshotDirectory, "project.icproj.json"), "utf8"),
      };
  const rawProject = JSON.parse(detail.projectText);
  const project = parseProject(detail.projectText);
  const analysis = analyzeDesignNetlist(project, {
    format: "spice",
    groundPin: "pin",
  });
  const errors = analysis.diagnostics.filter((item) => item.severity === "error");
  if (!analysis.ir || errors.length) {
    throw new Error(`${galleryId} extraction failed: ${JSON.stringify(errors)}`);
  }
  const source = project.documents.find(
    (document) => document.id === project.topDocumentId,
  );
  const cell = analysis.ir.cells.find((item) => item.id === analysis.ir.topCellId);
  const rawSource = rawProject.documents.find(
    (document) => document.id === rawProject.topDocumentId,
  );
  if (!source || !cell || !rawSource) throw new Error(`${galleryId} has no top cell`);

  const sourceInstances = new Map(source.instances.map((item) => [item.id, item]));
  const instances = cell.instances.flatMap((instance) => {
    const sourceInstance = sourceInstances.get(instance.id);
    assertSupportedHierarchy(project, analysis.ir, sourceInstance, instance);
    return normalizeInstance(galleryId, instance, sourceInstance);
  });

  const sourceTerminals = new Map(
    (source.netlist?.terminals ?? []).map((terminal) => [terminal.netId, terminal]),
  );
  const ports = cell.ports.map((port) => {
    const terminal = sourceTerminals.get(port.id);
    const sourceDirection = terminal?.direction ?? "generated-supply";
    return {
      name: port.name,
      netName: port.netName,
      sourceDirection,
      direction: targetDirection(port.name, sourceDirection),
    };
  });
  const sourceNets = cell.nets.map((net) => net.name);
  const connectedNets = new Set([
    ...instances.flatMap((item) => item.nodes.map((node) => node.netName)),
    ...ports.map((item) => item.netName),
  ]);
  const nets = sourceNets.filter((name) => connectedNets.has(name));
  const omittedResidualNets = sourceNets.filter((name) => !connectedNets.has(name));
  unique(instances.map((item) => item.reference), `${cellName} references`);
  unique(ports.map((item) => item.name), `${cellName} ports`);
  unique(nets, `${cellName} nets`);
  const netSet = new Set(nets);
  for (const instance of instances) {
    for (const node of instance.nodes) {
      if (!netSet.has(node.netName)) {
        throw new Error(`${cellName}:${instance.reference}.${node.pinName} missing net`);
      }
    }
  }
  for (const port of ports) {
    if (!netSet.has(port.netName)) throw new Error(`${cellName}:${port.name} missing net`);
  }
  const sourceGeometry = buildSourceGeometry(
    source,
    rawSource,
    cell,
    instances,
    ports,
    nets,
    createProjectSymbolResolver(project, builtInSymbols),
  );
  const geometryResolver = createProjectSymbolResolver(project, builtInSymbols);
  for (const instance of instances) {
    if (instance.sourceExpandedFrom) continue;
    instance.sourcePinPositions = Object.fromEntries(instance.nodes.map((node) => {
      const point = resolveEndpointPoint(source, geometryResolver, {
        kind: "terminal", instanceId: instance.id, pinName: node.sourcePinName,
      });
      if (!point) throw new Error(`${cellName}:${instance.reference}.${node.sourcePinName} has no coordinate`);
      return [node.pinName, point];
    }));
  }

  const netlist = createDesignNetlistExport(project, { format: "spice" });
  if (netlist.status !== "ready") {
    throw new Error(`${galleryId} SPICE export blocked`);
  }
  fs.writeFileSync(path.join(OUTPUT, `${cellName}.spi`), netlist.file.text);
  fs.writeFileSync(
    path.join(OUTPUT, `${cellName}.icproj.json`),
    detail.projectText,
  );
  fs.writeFileSync(path.join(OUTPUT, `${cellName}.gallery.json`), `${JSON.stringify(detail, null, 2)}\n`);

  return {
    cellName,
    galleryId,
    galleryName: detail.entry.name,
    galleryUrl: metadata.url ?? null,
    author: detail.entry.author,
    sourceDocumentId: source.id,
    geometryPolicy: { name: "hes-symbol-pitch-v1", spacingFactor },
    instances,
    ports,
    nets,
    sourceGeometry,
    omittedResidualNets,
    extractionDiagnostics: analysis.diagnostics,
    validation: {
      electricalAuthority: "Analog Canvas canonical SPICE IR",
      allTargetDevicePinsResolveToNets: true,
      sourceSubcircuitsExpandedExplicitly: instances.some(
        (item) => item.sourceInvocationKind === "expanded-subcircuit",
      ),
      allInstancePinsResolveToNets: true,
      allPortsResolveToNets: true,
      unconnectedEditorResidualNetsOmitted: omittedResidualNets,
    },
  };
}

if (fs.existsSync(OUTPUT) && fs.readdirSync(OUTPUT).length) {
  throw new Error("Output directory must be empty; existing bundles are not overwritten");
}
fs.mkdirSync(OUTPUT, { recursive: true });
const rejected = [];
const circuits = selection.flatMap(([galleryId, cellName]) => {
  try { return [withNativeNames(buildCircuit(galleryId, cellName))]; }
  catch (error) {
    if (!options["skip-unsupported"]) throw error;
    rejected.push({ galleryId, cellName, reason: error.message });
    return [];
  }
});
if (!circuits.length) throw new Error("No supported circuits in selection");

const manifest = {
  schema: "analog-canvas-hes-pyaether-import-v8",
  createdAt: new Date().toISOString(),
  ...(options["source-commit"] ? { sourceCommit: options["source-commit"] } : {}),
  sourceGallery: JSON.parse(fs.readFileSync(path.join(options["snapshot-export"], "manifest.json"), "utf8")).origin ?? null,
  targetLibrary: LIBRARY,
  targetTechnology: "hes",
  processMapping: {
    note: "Explicit model remap with parameter write/readback. Equal dimensions do not imply equal device physics across PDKs. Unsupported behavioral models are rejected.",
    nmos: "hes/n_mos_a/symbol",
    pmos: "hes/p_mos_a/symbol",
    capacitor: "analog/cap/symbol (preserves ideal source capacitance)",
    resistor: "analog/res/symbol (preserves ideal source resistance without PDK geometry clamping)",
    biasCurrentSource: "analog/idc/symbol",
    inverterExpansion: options["expand-inverters"]
      ? "Explicit CMOS approximation: P/N each w=1u, l=150n, nf=1, m=1; behavioral vt/td are not transistor parameters"
      : "disabled; enable explicitly with --expand-inverters",
    terminalMaps: {
      mos: { D: "D", G: "G", S: "S", B: "B" },
      passive: { "1": "P", "2": "N" },
      currentSource: { "+": "P", "-": "N" },
    },
  },
  circuits,
  rejected,
};
fs.writeFileSync(
  path.join(OUTPUT, "aether_hes_import_spec.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      output: OUTPUT,
      rejected,
      circuits: circuits.map((item) => ({
        cellName: item.cellName,
        galleryName: item.galleryName,
        instances: item.instances.length,
        ports: item.ports.map((port) => port.name),
        nets: item.nets.length,
      })),
    },
    null,
    2,
  ),
);
