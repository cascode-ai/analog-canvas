import {
  deviceDescriptor,
  drawnSwitchControl,
  type DeviceDescriptor,
  type DrawnSwitchControl,
} from "@icm/devices";
import { foldNetName, type CircuitProject, type Instance } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { drawnSwitchPhase } from "../drawn-switch.js";
import type { resolveDocumentLogicalNets } from "../logical-net.js";
import { directObjectLocator } from "../object-locator.js";
import type { ErcDiagnostic } from "./erc.js";
import { buildTerminalLogicalNetMap, terminalLocator } from "./erc-shared.js";

type Document = CircuitProject["documents"][number];
type LogicalNets = ReturnType<typeof resolveDocumentLogicalNets>;

/**
 * Pin roles that sense a voltage without setting it: a MOS gate or body, and
 * the inputs of a behavioural or logic block (as ERC_UNDRIVEN_GATE_NET reads
 * them).
 */
const SENSE_ROLES = new Set([
  "gate",
  "bulk",
  "input",
  "non-inverting-input",
  "inverting-input",
  "clock",
  "reset",
]);

/** The pin pairs a drawn switch closes, in some phase. */
function switchedPairs(
  device: DeviceDescriptor,
  control: DrawnSwitchControl,
): readonly (readonly [string, string])[] {
  switch (control) {
    case "phase":
      return [[device.pinOrder[0]!, device.pinOrder[1]!]];
    case "pin": {
      const [a, b] = device.pinOrder.filter((pin) => pin !== "CTRL");
      return a && b ? [[a, b]] : [];
    }
    case "selector":
      return [
        ["COM", "A"],
        ["COM", "B"],
      ];
    case "chopper":
      return [
        ["INP", "OUTP"],
        ["INN", "OUTN"],
        ["INP", "OUTN"],
        ["INN", "OUTP"],
      ];
  }
}

interface DrawnSwitch {
  readonly instance: Instance;
  readonly label: string;
  readonly device: DeviceDescriptor;
  readonly control: DrawnSwitchControl;
  /** The clock the switch reads: its phase's node, or its CTRL pin's Net. */
  readonly clock: {
    /** The Logical Net it is, where the Cell draws one. */
    readonly netId?: string;
    /** The node's name, as the netlist names it. */
    readonly name: string;
    /** Whether the label shows the switch's own name, not a phase. */
    readonly ownName: boolean;
  } | null;
}

/**
 * The Cell's drawn switches and the clock each reads. A switch's phase is the
 * Net of that name, written as typed or as a Net Label drawn the same way
 * names it (Φ_1 for Φ₁), as the netlist reads it; a label that still shows the
 * switch's own name clocks it by a phase of that name (extract-switch).
 */
function drawnSwitches(
  project: CircuitProject,
  document: Document,
  logicalNets: LogicalNets,
  netOf: (instanceId: string, pinName: string) => string | undefined,
): DrawnSwitch[] {
  const netByName = new Map<string, string>();
  for (const net of logicalNets.groups)
    if (net.name && !netByName.has(foldNetName(net.name)))
      netByName.set(foldNetName(net.name), net.id);
  const switches: DrawnSwitch[] = [];
  for (const instance of document.instances) {
    if (!instance.placement) continue;
    const device = deviceDescriptor(instance.symbolId, project);
    const control = device ? drawnSwitchControl(device) : null;
    if (!device || !control) continue;
    const label = instance.reference ?? instance.id;
    let clock: DrawnSwitch["clock"] = null;
    if (control === "pin") {
      const netId = netOf(instance.id, "CTRL");
      if (netId)
        clock = {
          netId,
          name: logicalNets.byId.get(netId)?.name ?? netId,
          ownName: false,
        };
    } else {
      const phase = drawnSwitchPhase(document, instance);
      const names = phase
        ? [phase.drawnName, phase.name].filter(
            (name): name is string => name !== undefined,
          )
        : [label];
      const named = names.find((name) => netByName.has(foldNetName(name)));
      clock = {
        ...(named ? { netId: netByName.get(foldNetName(named))! } : {}),
        name: named ?? (phase ? phase.name : label),
        ownName: !phase,
      };
    }
    switches.push({ instance, label, device, control, clock });
  }
  return switches.sort((left, right) =>
    left.label.localeCompare(right.label, "en", { numeric: true }),
  );
}

const byLabel = (left: { label: string }, right: { label: string }) =>
  left.label.localeCompare(right.label, "en", { numeric: true });

function listed(labels: readonly string[]): string {
  return labels.length > 1
    ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`
    : (labels[0] ?? "");
}

/**
 * Drawn-switch checks (#2604): clocks only a DC source sets, switches left on
 * their own name beside phased ones, switched pins shorted together, parallel
 * switches, and switched-capacitor nodes with no DC path in any phase.
 */
export function reportSwitchChecks(
  project: CircuitProject,
  document: Document,
  logicalNets: LogicalNets,
  resolver: SymbolResolver,
  diagnostics: ErcDiagnostic[],
): void {
  const netOfTerminal = buildTerminalLogicalNetMap(document, logicalNets);
  const netOf = (instanceId: string, pinName: string) =>
    netOfTerminal.get(`${instanceId}\u0000${pinName}`);
  const switches = drawnSwitches(project, document, logicalNets, netOf);
  if (!switches.length) return;
  reportDcClocks(project, document, logicalNets, switches, netOf, diagnostics);
  reportOwnNameClocks(document, switches, diagnostics);
  reportShortedSwitches(document, logicalNets, switches, netOf, diagnostics);
  reportParallelSwitches(document, logicalNets, switches, netOf, diagnostics);
  reportNodesWithoutDcPath(
    project,
    document,
    logicalNets,
    resolver,
    switches,
    diagnostics,
  );
}

/**
 * A switch clock whose Net a DC independent source holds from ground or a
 * supply, with no time-varying source on it: the clock box drawn and left on
 * `dc`, so every switch on it stays closed, or open, in every phase (#2604).
 */
function reportDcClocks(
  project: CircuitProject,
  document: Document,
  logicalNets: LogicalNets,
  switches: readonly DrawnSwitch[],
  netOf: (instanceId: string, pinName: string) => string | undefined,
  diagnostics: ErcDiagnostic[],
): void {
  const byClock = new Map<string, DrawnSwitch[]>();
  for (const drawn of switches) {
    const netId = drawn.clock?.netId;
    if (!netId) continue;
    byClock.set(netId, [...(byClock.get(netId) ?? []), drawn]);
  }
  if (!byClock.size) return;
  const constant = (netId: string) =>
    (logicalNets.byId.get(netId)?.powerDomain ?? "none") !== "none";
  type Source = { instance: Instance; dc: boolean; to: string };
  const sourcesByNet = new Map<string, Source[]>();
  for (const instance of document.instances) {
    const device = deviceDescriptor(instance.symbolId, project);
    if (device?.deviceClass !== "voltage-source" || device.id === "ammeter")
      continue;
    const [plus, minus] = device.pinOrder;
    const a = plus ? netOf(instance.id, plus) : undefined;
    const b = minus ? netOf(instance.id, minus) : undefined;
    if (!a || !b) continue;
    const parameters = instance.netlist?.parameters ?? {};
    const waveform = (
      parameters.waveform ??
      device.sourceWaveformDefault ??
      "dc"
    )
      .trim()
      .toLowerCase();
    const dc = waveform === "dc";
    for (const [netId, to] of [
      [a, b],
      [b, a],
    ] as const)
      sourcesByNet.set(netId, [
        ...(sourcesByNet.get(netId) ?? []),
        { instance, dc, to },
      ]);
  }
  for (const [netId, onClock] of byClock) {
    const sources = sourcesByNet.get(netId) ?? [];
    if (sources.some((source) => !source.dc)) continue;
    const held = sources.filter((source) => constant(source.to));
    if (!held.length) continue;
    const net = logicalNets.byId.get(netId);
    const name = net?.name ?? onClock[0]!.clock!.name;
    const labels = onClock.map((drawn) => drawn.label);
    const source = held[0]!.instance;
    const sourceLabel = source.reference ?? source.id;
    diagnostics.push({
      id: `erc:switch-clock-dc:${document.id}:${netId}`,
      domain: "erc",
      code: "ERC_SWITCH_CLOCK_DC",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `Clock ${name} of ${labels.length === 1 ? "switch" : "switches"} ${listed(labels)} is set only by DC source ${sourceLabel}, so ${labels.length === 1 ? "the switch never toggles" : "they never toggle"}: each stays closed, or open, in every phase. Give ${sourceLabel} a PULSE waveform, or drive the clock from the testbench`,
      primary: directObjectLocator(document.id, "instance", source.id),
      related: [
        directObjectLocator(document.id, "net", netId),
        ...onClock.map((drawn) =>
          directObjectLocator(document.id, "instance", drawn.instance.id),
        ),
      ],
      parameters: {
        netId,
        sourceInstanceId: source.id,
        count: labels.length,
      },
    });
  }
}

/**
 * A switch whose label still shows its own name, so it is clocked by a phase
 * of that name no Net of the Cell carries, while other switches of the Cell
 * read phases written on their labels: the netlist gives it a clock pin of
 * its own (S4), never driven by the intended phase (#2604). A Cell whose
 * switches all show their own names, or whose phases are named after its
 * switches, is clocked that way on purpose, by a testbench driving each name,
 * and is left alone.
 */
function reportOwnNameClocks(
  document: Document,
  switches: readonly DrawnSwitch[],
  diagnostics: ErcDiagnostic[],
): void {
  const phases = [
    ...new Set(
      switches
        .filter((drawn) => drawn.clock && !drawn.clock.ownName)
        .filter((drawn) => drawn.control !== "pin")
        .map((drawn) => drawn.clock!.name),
    ),
  ].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  // Phases named after switches (S1, S3) say the Cell's clocks follow its
  // switches' names, so one left on its own name follows them too.
  const references = new Set(switches.map((drawn) => foldNetName(drawn.label)));
  if (
    !phases.length ||
    phases.some((phase) => references.has(foldNetName(phase)))
  )
    return;
  for (const drawn of switches) {
    if (!drawn.clock?.ownName || drawn.clock.netId) continue;
    diagnostics.push({
      id: `erc:switch-clocked-by-own-name:${document.id}:${drawn.instance.id}`,
      domain: "erc",
      code: "ERC_SWITCH_CLOCKED_BY_OWN_NAME",
      severity: "warning",
      confidence: "medium",
      gateEligible: false,
      message: `Switch ${drawn.label} shows its own name, so it is clocked by a phase ${drawn.label} of its own, while the Cell's other switches read ${phases.length === 1 ? "phase" : "phases"} ${listed(phases)}. Write its phase on its label (set-switch-control) to put it on the intended clock`,
      primary: directObjectLocator(document.id, "instance", drawn.instance.id),
      related: [],
      parameters: { instanceId: drawn.instance.id, phase: drawn.label },
    });
  }
}

/**
 * A drawn switch of more than two pins, a CTRL switch, selector or chopper,
 * whose switched pins are on one Net: closing it does nothing (two-pin
 * switches are ERC_SHORTED_DEVICE's like any two-pin part).
 */
function reportShortedSwitches(
  document: Document,
  logicalNets: LogicalNets,
  switches: readonly DrawnSwitch[],
  netOf: (instanceId: string, pinName: string) => string | undefined,
  diagnostics: ErcDiagnostic[],
): void {
  for (const drawn of switches) {
    if (drawn.control === "phase") continue;
    for (const [a, b] of switchedPairs(drawn.device, drawn.control)) {
      const netId = netOf(drawn.instance.id, a);
      if (!netId || netId !== netOf(drawn.instance.id, b)) continue;
      const name = logicalNets.byId.get(netId)?.name;
      diagnostics.push({
        id: `erc:shorted-part:${document.id}:${drawn.instance.id}:${a}:${b}`,
        domain: "erc",
        code: "ERC_SHORTED_DEVICE",
        severity: "warning",
        confidence: "high",
        gateEligible: false,
        message: `${drawn.label}'s switched pins ${a} and ${b} are on one Net${name ? ` (${name})` : ""}, so the switch is shorted`,
        primary: directObjectLocator(
          document.id,
          "instance",
          drawn.instance.id,
        ),
        related: [
          terminalLocator(document.id, drawn.instance.id, a),
          terminalLocator(document.id, drawn.instance.id, b),
        ],
        parameters: { instanceId: drawn.instance.id, netId },
      });
    }
  }
}

/**
 * Two or more two-way switches across the same two Nets. On one clock one is
 * a duplicate; on different clocks the pair closes whenever either clock is
 * high, which is usually a switch wired to the wrong Net (#2604).
 */
function reportParallelSwitches(
  document: Document,
  logicalNets: LogicalNets,
  switches: readonly DrawnSwitch[],
  netOf: (instanceId: string, pinName: string) => string | undefined,
  diagnostics: ErcDiagnostic[],
): void {
  const byNets = new Map<
    string,
    { nets: [string, string]; switches: DrawnSwitch[] }
  >();
  for (const drawn of switches) {
    if (drawn.control !== "phase" && drawn.control !== "pin") continue;
    const [pair] = switchedPairs(drawn.device, drawn.control);
    if (!pair) continue;
    const a = netOf(drawn.instance.id, pair[0]);
    const b = netOf(drawn.instance.id, pair[1]);
    if (!a || !b || a === b) continue;
    const nets = [a, b].sort() as [string, string];
    const key = nets.join("\u0000");
    const entry = byNets.get(key) ?? { nets, switches: [] };
    entry.switches.push(drawn);
    byNets.set(key, entry);
  }
  const nameOf = (netId: string) => logicalNets.byId.get(netId)?.name;
  for (const { nets, switches: parallel } of byNets.values()) {
    if (parallel.length < 2) continue;
    parallel.sort(byLabel);
    const clocks = [
      ...new Set(
        parallel.map((drawn) => drawn.clock?.netId ?? drawn.clock?.name ?? ""),
      ),
    ];
    const clockNames = parallel.map((drawn) => drawn.clock?.name ?? "?");
    const same = clocks.length === 1;
    const labels = parallel.map((drawn) => drawn.label);
    const named = nets.map(nameOf);
    const where = named.every(Boolean)
      ? ` (${named[0]} and ${named[1]})`
      : named.some(Boolean)
        ? ` (one is ${named.find(Boolean)})`
        : "";
    diagnostics.push({
      id: `erc:parallel-switches:${document.id}:${nets.join(":")}`,
      domain: "erc",
      code: "ERC_PARALLEL_SWITCHES",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: same
        ? `Switches ${listed(labels)} join the same two Nets${where} on the same clock ${clockNames[0]}, so all but one are duplicates. Delete the extra, or wire it to the Net the figure shows`
        : `Switches ${listed(labels)} join the same two Nets${where} on clocks ${listed([...new Set(clockNames)])}, so the Nets are joined whenever any of them is closed. Check whether one is wired to the wrong Net`,
      primary: directObjectLocator(
        document.id,
        "instance",
        parallel[0]!.instance.id,
      ),
      related: [
        ...parallel
          .slice(1)
          .map((drawn) =>
            directObjectLocator(document.id, "instance", drawn.instance.id),
          ),
        ...nets.map((netId) => directObjectLocator(document.id, "net", netId)),
      ],
      parameters: {
        netId: nets[0],
        otherNetId: nets[1],
        count: parallel.length,
        sameClock: same,
      },
    });
  }
}

/**
 * Nets that reach only capacitor plates, switched pins of drawn switches and
 * pins that only sense a voltage (op-amp inputs, gates, switch clocks), taken
 * together with every Net a switch can join them to: in no phase does any of
 * them reach a resistor, source, transistor channel, supply, ground or Cell
 * Pin, so their DC level is undefined and the operating point is singular or
 * the transient aborts (#2604). Reported once for each such group with at
 * least one capacitor and one switch.
 */
function reportNodesWithoutDcPath(
  project: CircuitProject,
  document: Document,
  logicalNets: LogicalNets,
  resolver: SymbolResolver,
  switches: readonly DrawnSwitch[],
  diagnostics: ErcDiagnostic[],
): void {
  const switched = new Map(
    switches.map((drawn) => [
      drawn.instance.id,
      new Set(switchedPairs(drawn.device, drawn.control).flat()),
    ]),
  );
  const instances = new Map(
    document.instances.map((instance) => [instance.id, instance]),
  );
  type Kind = "capacitor" | "switch" | "sense" | "anchor";
  const kindOf = (instanceId: string, pinName: string): Kind => {
    const pins = switched.get(instanceId);
    if (pins) return pins.has(pinName) ? "switch" : "sense";
    const instance = instances.get(instanceId);
    if (!instance) return "anchor";
    const device = deviceDescriptor(instance.symbolId, project);
    if (device?.deviceClass === "capacitor" && device.pinOrder.length === 2)
      return "capacitor";
    const role = resolver
      .resolve(instance.symbolId, instance.symbolVariantId)
      ?.definition.pins.find((pin) => pin.name === pinName)
      ?.role.toLowerCase();
    return role !== undefined && SENSE_ROLES.has(role) ? "sense" : "anchor";
  };
  type Pin = { instanceId: string; pinName: string; kind: Kind; text: string };
  const pinsByNet = new Map<string, Pin[]>();
  for (const net of document.nets) {
    const netId = logicalNets.byBaseNetId.get(net.id)?.id ?? net.id;
    const pins = pinsByNet.get(netId) ?? [];
    for (const terminal of net.terminals) {
      const instance = instances.get(terminal.instanceId);
      pins.push({
        instanceId: terminal.instanceId,
        pinName: terminal.pinName,
        kind: kindOf(terminal.instanceId, terminal.pinName),
        text: `${instance?.reference ?? terminal.instanceId}.${terminal.pinName}`,
      });
    }
    pinsByNet.set(netId, pins);
  }
  const anchored = (netId: string) => {
    const net = logicalNets.byId.get(netId);
    return (
      !net ||
      net.scope === "global" ||
      net.powerDomain !== "none" ||
      net.formalTerminalIds.length > 0 ||
      (pinsByNet.get(netId) ?? []).some((pin) => pin.kind === "anchor")
    );
  };
  // Nets each switch can join, in some phase.
  const joined = new Map<string, Set<string>>();
  const join = (a: string, b: string) => {
    joined.set(a, (joined.get(a) ?? new Set()).add(b));
    joined.set(b, (joined.get(b) ?? new Set()).add(a));
  };
  const netOfTerminal = buildTerminalLogicalNetMap(document, logicalNets);
  for (const drawn of switches)
    for (const [a, b] of switchedPairs(drawn.device, drawn.control)) {
      const netA = netOfTerminal.get(`${drawn.instance.id}\u0000${a}`);
      const netB = netOfTerminal.get(`${drawn.instance.id}\u0000${b}`);
      if (netA && netB && netA !== netB) join(netA, netB);
    }
  const seen = new Set<string>();
  for (const start of [...pinsByNet.keys()].sort()) {
    if (seen.has(start)) continue;
    const group: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const netId = queue.pop()!;
      group.push(netId);
      for (const next of joined.get(netId) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    }
    if (group.some(anchored)) continue;
    const pins = group.flatMap((netId) => pinsByNet.get(netId) ?? []);
    if (
      !pins.some((pin) => pin.kind === "capacitor") ||
      !pins.some((pin) => pin.kind === "switch")
    )
      continue;
    group.sort((left, right) =>
      (logicalNets.byId.get(left)?.name ?? `￿${left}`).localeCompare(
        logicalNets.byId.get(right)?.name ?? `￿${right}`,
        "en",
        { numeric: true },
      ),
    );
    const texts = pins
      .map((pin) => pin.text)
      .sort((left, right) =>
        left.localeCompare(right, "en", { numeric: true }),
      );
    const shown =
      texts.slice(0, 6).join(", ") + (texts.length > 6 ? ", …" : "");
    const names = group
      .map((netId) => logicalNets.byId.get(netId)?.name)
      .filter((name): name is string => Boolean(name));
    const subject =
      group.length === 1
        ? `Net ${names[0] ?? group[0]}`
        : names.length === group.length
          ? `Nets ${listed(names)}`
          : names.length
            ? `${group.length} Nets (${listed([...names, `${group.length - names.length} unnamed`])})`
            : `${group.length} Nets`;
    diagnostics.push({
      id: `erc:no-dc-path:${document.id}:${group[0]}`,
      domain: "erc",
      code: "ERC_NO_DC_PATH",
      severity: "warning",
      confidence: "medium",
      gateEligible: false,
      message: `${subject} ${group.length === 1 ? "has" : "have"} no DC path in any phase: ${group.length === 1 ? "it reaches" : "they reach"} only capacitors, switches and inputs (${shown}), and no switch joins ${group.length === 1 ? "it" : "them"} to a source, resistor, supply or Cell Pin, so the DC level is undefined and the operating point may not solve. Add the reset switch or bias the figure shows`,
      primary: directObjectLocator(document.id, "net", group[0]!),
      related: group
        .slice(1)
        .map((netId) => directObjectLocator(document.id, "net", netId)),
      parameters: { netId: group[0]!, count: group.length },
    });
  }
}
