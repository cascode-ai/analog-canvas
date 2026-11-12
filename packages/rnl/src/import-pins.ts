import { mosBulkKind } from "@icm/derived";
import { bindsProjectCell } from "@icm/devices";
import {
  analyzeDesignNetlistForAuthoring,
  createDesignNetlistExport,
} from "@icm/netlist";
import {
  deriveStableId,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";

import { rnlBodyPortOrder } from "./symbol-map.js";
import { rnlIdName, type RnlSnapshot } from "./rnl-snapshot.js";

/**
 * A Cell port the drawing shows only as a power label that names it, no Pin
 * drawn: the label is the port, as the editor keeps a local power label.
 */
export interface RnlPowerLabelPort {
  documentId: string;
  terminalId: string;
  labelId: string;
}

/**
 * Each such port as the editor keeps it (#1783): the label is the terminal's
 * interface, and claims its net's name as a supply, so its rails are rails;
 * the Pin the netlist import gave it goes, with what hangs on it. The
 * circuit is the same; only which object owns the port changes, and with it
 * where the netlist prints the port.
 */
export function withPowerLabelPorts(
  project: CircuitProject,
  ports: readonly RnlPowerLabelPort[],
): CircuitProject {
  if (!ports.length) return project;
  const next = structuredClone(project);
  for (const { documentId, terminalId, labelId } of ports) {
    const document = next.documents.find((item) => item.id === documentId);
    const terminal = document?.netlist?.terminals.find(
      (item) => item.id === terminalId,
    );
    const pinId = terminal?.interfaceInstanceIds[0];
    if (!document || !terminal || !pinId) continue;
    document.instances = document.instances.filter(
      (instance) => instance.id !== pinId,
    );
    for (const net of document.nets)
      net.terminals = net.terminals.filter((item) => item.instanceId !== pinId);
    // The Pin's own labels go with it; a power label hung on it stays where
    // it stands. The import hangs one on the Pin only where its net has no
    // junction beside it, so it stands free.
    document.annotations = document.annotations.flatMap((item) => {
      if (item.anchor.kind !== "object" || item.anchor.objectId !== pinId)
        return [item];
      if (item.kind !== "power-label") return [];
      return [
        {
          ...item,
          anchor: {
            kind: "free" as const,
            position: item.anchor.fallbackPosition,
          },
        },
      ];
    });
    terminal.interfaceInstanceIds = [];
    terminal.interfaceAnnotationId = labelId;
    document.connectivityEvidence.push({
      id: deriveStableId(
        "connectivity-evidence",
        document.id,
        "power-marker",
        labelId,
        terminal.netId,
      ),
      kind: "name-claim",
      netId: terminal.netId,
      name: terminal.name,
      scope: "local",
      powerDomain: "vdd",
      owner: { kind: "power-marker", objectId: labelId },
    });
  }
  return next;
}

/**
 * The pins Analog Canvas adds to a Cell printed as a subcircuit (#1787):
 * ground (VSS, or GND, GND__n) where the Cell meets ground only through the
 * Cells it calls, a switch it draws or a MOS body left unwired; VDD where a
 * PMOS body is left unwired; the phase a switch's label clocks it by. The
 * drawing shows none of them, so the pin is undrawn and alone on its net
 * but for those bodies, and the rails of the Library gates it draws, once
 * its children's pins are gone. Where the Cell
 * prints the same pin again without it, it goes, the bodies unwired again
 * as drawn, and then a caller's pin it left alone in turn. A pin the Cell
 * would print under another name, or not at all, is the author's and stays.
 *
 * All or none: the pins go only where the netlist then prints as it prints
 * now, or prints the file's own circuit (`printsFileCircuit`). A Cell whose
 * added ground pin reads as a port prints a second one beside it now (GND
 * beside VSS), which the file never had: there the file's circuit is the
 * reference, even where the pins leave the netlist unprintable (a pin on a
 * global net). A call that passes such a pin a node of its own (a body bias,
 * the other phase) keeps every pin.
 */
export function removeAddedPins(
  project: CircuitProject,
  undrawnPins: ReadonlySet<string>,
  printsFile: (trial: CircuitProject) => boolean,
): void {
  const trial = structuredClone(project);
  removeEachAddedPin(trial, undrawnPins);
  const printed = (from: CircuitProject) => {
    const result = createDesignNetlistExport(from, {
      format: "spice",
      uncalledCells: true,
    });
    return result.status === "ready" ? result.file.text : null;
  };
  const now = printed(project);
  if ((now !== null && printed(trial) === now) || printsFile(trial))
    project.documents = trial.documents;
}

/**
 * Whether a Project prints the circuit the file's own netlist holds, as the
 * runtime read it (each level's host): every Cell it prints, generated
 * bodies aside, is a subcircuit of the file, with the same ports in order
 * and cards on the same nets, each card's in order, the cards in any order.
 */
export function printsFileCircuit(
  project: CircuitProject,
  snapshot: RnlSnapshot,
): boolean {
  const result = createDesignNetlistExport(project, {
    format: snapshot.dialect === "spectre" ? "spectre" : "spice",
    bodyPortOrder: rnlBodyPortOrder(project),
    includeIr: true,
    uncalledCells: true,
  });
  if (result.status !== "ready" || !result.ir) return false;
  // Nets as both sides spell them: RNL's `&VSS` and `"VIN<0>"`, Spectre's
  // `Vin\+`.
  const plain = (net: string) => {
    const bare = net.replace(/^&/u, "");
    return (rnlIdName(`&${bare}`, "&") ?? bare).replace(/\\/gu, "");
  };
  const cards = (nets: readonly string[][], net = plain) =>
    nets.map((card) => JSON.stringify(card.map(net))).sort();
  const hosts = new Map(
    snapshot.levels.flatMap((level) =>
      level.kind === "subckt" && level.host ? [[level.name, level.host]] : [],
    ),
  );
  const cells = result.ir.cells.filter(
    (cell) => cell.origin !== "generated-model",
  );
  return (
    cells.length > 0 &&
    cells.every((cell) => {
      const host = hosts.get(cell.name);
      // RNL reads SPICE's GND as ground (0), as ngspice does, in a Cell
      // with no net named 0 (#1784).
      const ground = cell.nets.some((net) => net.name === "0")
        ? undefined
        : cell.nets.find((net) => net.name.toUpperCase() === "GND")?.name;
      const hostNet = (net: string) => {
        const name = plain(net);
        return name === "0" && ground ? ground : name;
      };
      return (
        !!host &&
        JSON.stringify(cell.ports.map((port) => plain(port.netName))) ===
          JSON.stringify(host.ports.map(hostNet)) &&
        JSON.stringify(
          cards(
            cell.instances.map((instance) =>
              instance.nodes.map((node) => node.netName),
            ),
          ),
        ) ===
          JSON.stringify(
            cards(
              host.instances.map((instance) =>
                [...instance.terminals]
                  .sort((a, b) => a.n - b.n)
                  .map((terminal) => terminal.net),
              ),
              hostNet,
            ),
          )
      );
    })
  );
}

/**
 * A Cell port the drawing does not draw, as it was: one whose interface is a
 * hidden power label. A file Analog Canvas writes draws each Pin a Cell has
 * and each power label it shows, so a port it draws neither for was owned
 * by a hidden power label, the only interface a port has without a Pin. The
 * Pin the netlist import gave it goes, as for a port drawn as its power
 * label (#1783), and a hidden one bound to the port takes its place there.
 * The port stays, and the netlist with it.
 */
export function unpinUndrawnPorts(
  project: CircuitProject,
  canvasDocuments: ReadonlySet<string>,
  undrawnPins: ReadonlySet<string>,
  powerLabelPorts: RnlPowerLabelPort[],
): void {
  const labelled = new Set(powerLabelPorts.map((port) => port.terminalId));
  const next = structuredClone(project);
  const ports: RnlPowerLabelPort[] = [];
  for (const document of next.documents.filter(({ id }) =>
    canvasDocuments.has(id),
  ))
    for (const terminal of document.netlist?.terminals ?? []) {
      const [pinId, ...more] = terminal.interfaceInstanceIds;
      if (
        !pinId ||
        more.length ||
        labelled.has(terminal.id) ||
        !undrawnPins.has(pinKey(document.id, pinId))
      )
        continue;
      // A pin alone on its net but for unwired bodies and rails is one the
      // export adds, which removeAddedPins kept: it is no power label's.
      const net = document.nets.find((item) => item.id === terminal.netId);
      if (
        net?.terminals.every(
          (item) => item.instanceId === pinId || unwiredSupply(document, item),
        )
      )
        continue;
      const pin = document.instances.find((item) => item.id === pinId);
      const labelId = deriveStableId("power-label", document.id, terminal.id);
      document.annotations.push({
        id: labelId,
        kind: "power-label",
        netId: terminal.netId,
        binding: { kind: "cell-terminal-name", terminalId: terminal.id },
        anchor: {
          kind: "free",
          position: pin?.placement?.position ?? { x: 0, y: 0 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
        visible: false,
      });
      ports.push({ documentId: document.id, terminalId: terminal.id, labelId });
    }
  if (!ports.length) return;
  const printed = (from: CircuitProject) => {
    const result = createDesignNetlistExport(from, {
      format: "spice",
      uncalledCells: true,
    });
    return result.status === "ready" ? result.file.text : null;
  };
  const now = printed(project);
  if (now === null || printed(withPowerLabelPorts(next, ports)) !== now) return;
  project.documents = next.documents;
  powerLabelPorts.push(...ports);
}

function removeEachAddedPin(
  project: CircuitProject,
  undrawnPins: ReadonlySet<string>,
): void {
  for (let removed = true; removed;) {
    removed = false;
    for (const document of project.documents)
      for (const terminal of [...(document.netlist?.terminals ?? [])]) {
        const pins = new Set(terminal.interfaceInstanceIds);
        const net = document.nets.find((item) => item.id === terminal.netId);
        if (
          !net ||
          !pins.size ||
          [...pins].some((id) => !undrawnPins.has(pinKey(document.id, id))) ||
          !net.terminals.every(
            (item) =>
              pins.has(item.instanceId) || unwiredSupply(document, item),
          ) ||
          document.annotations.some(
            (item) => "netId" in item && item.netId === net.id,
          ) ||
          document.routes.some((route) => route.netId === net.id) ||
          document.netlist!.terminals.some(
            (item) =>
              item !== terminal &&
              (item.netId === net.id ||
                item.name.toUpperCase() === terminal.name.toUpperCase()),
          )
        )
          continue;
        const trial = structuredClone(project);
        const trialDocument = trial.documents.find(
          (item) => item.id === document.id,
        )!;
        removeAddedPin(
          trial,
          trialDocument,
          trialDocument.netlist!.terminals.find(
            (item) => item.id === terminal.id,
          )!,
        );
        // What the export prints for the Cell, read as the editor reads a
        // Cell it has not finished: another Cell's unrelated error leaves
        // this one's pins as they are.
        const printed = analyzeDesignNetlistForAuthoring(trial, {
          groundPin: "pin",
          uncalledCells: true,
        }).ir?.cells.find((cell) => cell.id === document.id);
        if (!printed?.ports.some((port) => port.name === terminal.name))
          continue;
        removeAddedPin(project, document, terminal);
        removed = true;
      }
  }
}

/**
 * A pin no drawing wires, which takes the Cell's supply when left alone:
 * a MOS body left unwired, as the netlist import binds it, or the rail of
 * a Library gate or flip-flop, which its symbol draws no pin for, drawn on
 * a Cell of the Project (#1450) or on the body the netlist writes itself.
 * The pin is one of the net's Document, whose own instance it names (#1955).
 */
function unwiredSupply(
  document: SchematicDocument,
  item: { instanceId: string; pinName: string },
) {
  const instance = document.instances.find(
    (candidate) => candidate.id === item.instanceId,
  );
  if (!instance) return false;
  if (item.pinName === "B")
    return !!mosBulkKind(instance) && !instance.mosBulkBinding;
  return (
    (item.pinName === "VDD" || item.pinName === "VSS") &&
    (instance.netlist?.binding?.kind === "subcircuit" ||
      instance.netlist?.binding?.kind === "unresolved-subcircuit") &&
    bindsProjectCell(instance.symbolId)
  );
}

/**
 * An added pin and its net gone, with each MOS body on it unwired and a Cell
 * default naming it dropped, and its callers no longer passing it a node.
 */
function removeAddedPin(
  project: CircuitProject,
  document: SchematicDocument,
  terminal: NonNullable<SchematicDocument["netlist"]>["terminals"][number],
): void {
  removeGroundPin(project, document, terminal);
  document.nets = document.nets.filter((net) => net.id !== terminal.netId);
  document.connectivityEvidence = document.connectivityEvidence.filter(
    (evidence) => evidence.netId !== terminal.netId,
  );
  const defaults = document.mosBulkDefaults;
  if (defaults?.nmosNetId === terminal.netId) delete defaults.nmosNetId;
  if (defaults?.pmosNetId === terminal.netId) delete defaults.pmosNetId;
  if (defaults && !defaults.nmosNetId && !defaults.pmosNetId)
    delete document.mosBulkDefaults;
}

/**
 * Undo a ground pin Analog Canvas added to a Cell: the importer's port and
 * its Cell Pin go, and each call stops passing a node to it.
 */
export const GROUND_PIN_NAME = /^(?:VSS|GND(?:__\d+)?)$/iu;

export const pinKey = (documentId: string, pin: string) =>
  `${documentId}\n${pin}`;

/**
 * Each Cell's pins named as ground pins that every call of the Cell ties to
 * ground: ground (0) itself, or such a pin of its caller's. A Cell no call
 * reaches ties them all. Read from the netlist as imported, before any level
 * undoes a pin.
 */
export function groundTiedPins(project: CircuitProject): Set<string> {
  const calls = (documentId: string) =>
    project.documents.flatMap((caller) =>
      caller.instances.flatMap((instance) => {
        const binding = instance.netlist?.binding;
        return binding?.kind === "subcircuit" &&
          binding.childDocumentId === documentId
          ? [{ caller, instance }]
          : [];
      }),
    );
  const known = new Map<string, boolean>();
  const tied = (documentId: string, pin: string): boolean => {
    const key = pinKey(documentId, pin);
    const seen = known.get(key);
    if (seen !== undefined) return seen;
    // A Cell that calls itself through this pin does not tie it.
    known.set(key, false);
    const answer = calls(documentId).every(({ caller, instance }) => {
      const net = caller.nets.find((item) =>
        item.terminals.some(
          (end) => end.instanceId === instance.id && end.pinName === pin,
        ),
      );
      if (!net) return false;
      const named = caller.importReference?.nets.find(
        (item) => item.id === net.id,
      );
      if (named?.name === "0" && named.scope === "global") return true;
      const own = caller.netlist?.terminals.find(
        (item) => item.netId === net.id && GROUND_PIN_NAME.test(item.name),
      );
      return own !== undefined && tied(caller.id, own.name);
    });
    known.set(key, answer);
    return answer;
  };
  const pins = new Set<string>();
  for (const document of project.documents)
    for (const terminal of document.netlist?.terminals ?? [])
      if (
        GROUND_PIN_NAME.test(terminal.name) &&
        tied(document.id, terminal.name)
      )
        pins.add(pinKey(document.id, terminal.name));
  return pins;
}

export function removeGroundPin(
  project: CircuitProject,
  document: SchematicDocument,
  terminal: NonNullable<SchematicDocument["netlist"]>["terminals"][number],
): void {
  const pins = new Set(terminal.interfaceInstanceIds);
  document.instances = document.instances.filter(
    (instance) => !pins.has(instance.id),
  );
  for (const net of document.nets)
    net.terminals = net.terminals.filter((item) => !pins.has(item.instanceId));
  document.netlist!.terminals = document.netlist!.terminals.filter(
    (item) => item !== terminal,
  );
  for (const caller of project.documents)
    for (const instance of caller.instances) {
      const binding = instance.netlist?.binding;
      if (
        binding?.kind !== "subcircuit" ||
        binding.childDocumentId !== document.id
      )
        continue;
      for (const net of caller.nets)
        net.terminals = net.terminals.filter(
          (item) =>
            item.instanceId !== instance.id || item.pinName !== terminal.name,
        );
    }
}
