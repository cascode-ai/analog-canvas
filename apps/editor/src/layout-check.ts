// Layout checks: what a reviewer keeps finding by eye in drawn schematics,
// counted from the Project itself. Lines that miss alignment by a step or
// two, devices almost on one row or column, twins (a differential pair's
// halves) not drawn as mirror images, branch dots that crowd one node, and
// wiring drawn twice. Each finding names where it is, in the drawing's own
// coordinates, so a picture can box it.

import {
  routeEnd,
  type CircuitProject,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import {
  resolveDocumentLogicalNets,
  resolveDocumentRoutingGeometry,
  resolveEndpointConnection,
} from "@icm/derived";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { structuralTwins, type NetlistDevice } from "./netlist-match";

export type LayoutCheckKind =
  | "jog"
  | "near-row"
  | "near-column"
  | "dots-misaligned"
  | "asymmetric-pair"
  | "close-dots"
  | "wire-loop"
  | "overlapping-wires";

export interface LayoutFinding {
  kind: LayoutCheckKind;
  message: string;
  /** Where it is, in the document's coordinates. */
  box: { x: number; y: number; w: number; h: number };
  /** The devices it concerns, by Reference. */
  devices?: string[];
}

/** A step this small between two parallel runs is a miss, not a design. */
const JOG = 20;
/**
 * Pins or dots this close in one axis were meant to share it: a grid step
 * or so. Two grid steps (20) is a deliberate spacing in the house style
 * (branches brought in 20 apart), so it is left alone.
 */
const MISS = { min: 1, max: 15 };
/** Branch dots of one Net this close read as one smudged node. */
const CLOSE_DOTS = 10;
/** Twins this far apart in height are on different rows by design. */
const TWIN_ROWS = 40;

const DEVICE_FAMILY: Record<string, string> = {
  nmos: "mos",
  pmos: "mos",
  npn: "bjt",
  pnp: "bjt",
  resistor: "passive",
  capacitor: "passive",
  inductor: "passive",
};

/** Each device symbol's kind, as the netlist pairing names kinds. */
const KIND: Record<string, string> = {
  nmos: "nmos",
  pmos: "pmos",
  npn: "npn",
  pnp: "pnp",
  njfet: "njfet",
  pjfet: "pjfet",
  resistor: "res",
  capacitor: "cap",
  inductor: "ind",
};

/** A pin's role in a twin match; a MOS body takes none (as in the pairing). */
function pinRole(symbolId: string, pinName: string): string | null {
  if (symbolId === "nmos" || symbolId === "pmos")
    return pinName === "G" ? "g" : pinName === "B" ? null : "ds";
  if (symbolId === "npn" || symbolId === "pnp") return pinName.toLowerCase();
  if (symbolId === "njfet" || symbolId === "pjfet")
    return pinName === "G" ? "g" : "ds";
  if (KIND[symbolId]) return "t";
  return null;
}

const familyOf = (symbolId: string) =>
  DEVICE_FAMILY[symbolId] ??
  (/mos|fet/u.test(symbolId)
    ? "mos"
    : /npn|pnp/u.test(symbolId)
      ? "bjt"
      : /resistor|capacitor|inductor/u.test(symbolId)
        ? "passive"
        : null);

const around = (points: readonly Point[], pad = 10) => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return {
    x,
    y,
    w: Math.max(...xs) + pad - x,
    h: Math.max(...ys) + pad - y,
  };
};

const length = (from: Point, to: Point) =>
  Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
const direction = (from: Point, to: Point) =>
  from.x === to.x ? "v" : from.y === to.y ? "h" : "d";

/** Every finding in the Project's top-level drawing. */
export function checkLayout(project: CircuitProject): LayoutFinding[] {
  const document = project.documents.find(
    (each) => each.id === project.topDocumentId,
  );
  if (!document) return [];
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  return [
    ...wireFindings(document, resolver),
    ...deviceFindings(document, resolver),
  ];
}

function wireFindings(
  document: SchematicDocument,
  resolver: ReturnType<typeof createProjectSymbolResolver>,
): LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  const geometry = resolveDocumentRoutingGeometry(document, resolver);
  const segmentsByNet = new Map<string, [Point, Point][]>();
  for (const route of geometry.routes.values()) {
    const segments = route.segments.filter(
      (segment) => length(segment.from, segment.to) > 0,
    );
    segmentsByNet.set(route.netId, [
      ...(segmentsByNet.get(route.netId) ?? []),
      ...segments.map((segment): [Point, Point] => [segment.from, segment.to]),
    ]);
    // A short middle step between two runs going the same way: its ends
    // were meant to be in line.
    for (let index = 1; index < segments.length - 1; index += 1) {
      const before = segments[index - 1]!;
      const step = segments[index]!;
      const after = segments[index + 1]!;
      const run = direction(before.from, before.to);
      if (
        run !== "d" &&
        run === direction(after.from, after.to) &&
        direction(step.from, step.to) !== run &&
        length(step.from, step.to) <= JOG
      )
        findings.push({
          kind: "jog",
          message: `A ${length(step.from, step.to)}-unit step in a wire: its two ends are slightly out of line.`,
          box: around([step.from, step.to], 14),
        });
    }
  }
  // Wires of one Net lying on top of each other.
  for (const segments of segmentsByNet.values())
    for (let a = 0; a < segments.length; a += 1)
      for (let b = a + 1; b < segments.length; b += 1) {
        const overlap = collinearOverlap(segments[a]!, segments[b]!);
        if (overlap)
          findings.push({
            kind: "overlapping-wires",
            message: "Two wires of the same net run over each other.",
            box: around(overlap, 8),
          });
      }
  // Branch dots: where three or more wire ends meet.
  const ends = new Map<string, number>();
  for (const route of document.routes)
    for (const end of [route.start, routeEnd(route)])
      if (end?.kind === "junction")
        ends.set(end.junctionId, (ends.get(end.junctionId) ?? 0) + 1);
  const dots = document.junctions.filter(
    (junction) =>
      junction.role !== "route-anchor" && (ends.get(junction.id) ?? 0) >= 3,
  );
  for (let a = 0; a < dots.length; a += 1)
    for (let b = a + 1; b < dots.length; b += 1) {
      const first = dots[a]!;
      const second = dots[b]!;
      if (
        first.netId === second.netId &&
        length(first.position, second.position) <= CLOSE_DOTS
      )
        findings.push({
          kind: "close-dots",
          message: `Two branch dots of one net ${length(first.position, second.position)} units apart: one node drawn as two.`,
          box: around([first.position, second.position], 12),
        });
      // Nodes nearly level, or nearly in line, by a grid step.
      const dx = Math.abs(first.position.x - second.position.x);
      const dy = Math.abs(first.position.y - second.position.y);
      if (
        (dy >= MISS.min && dy <= MISS.max && dx >= 20 && dx <= 200) ||
        (dx >= MISS.min && dx <= MISS.max && dy >= 20 && dy <= 200)
      )
        findings.push({
          kind: "dots-misaligned",
          message: `Two branch dots ${dy <= MISS.max ? `${dy} units off level` : `${dx} units out of line`}: these nodes were meant to line up.`,
          box: around([first.position, second.position], 12),
        });
    }
  // A Net's wires closing a loop: one connection drawn twice.
  const byNet = new Map<string, SchematicDocument["routes"]>();
  for (const route of document.routes)
    byNet.set(route.netId, [...(byNet.get(route.netId) ?? []), route]);
  for (const routes of byNet.values()) {
    const parent = new Map<string, string>();
    const find = (key: string): string => {
      const up = parent.get(key) ?? key;
      if (up === key) return key;
      const root = find(up);
      parent.set(key, root);
      return root;
    };
    for (const route of routes) {
      const end = routeEnd(route);
      if (!end) continue;
      const a = find(endpointKey(route.start));
      const b = find(endpointKey(end));
      if (a === b) {
        const drawn = geometry.routes.get(route.id);
        findings.push({
          kind: "wire-loop",
          message:
            "A wire joins two points of a net already joined: the connection is drawn twice.",
          box: around(drawn?.centerline.length ? drawn.centerline : [], 8),
        });
      } else parent.set(a, b);
    }
  }
  return findings.filter((finding) => Number.isFinite(finding.box.x));
}

function endpointKey(
  endpoint: SchematicDocument["routes"][number]["start"],
): string {
  return endpoint.kind === "terminal"
    ? `t:${endpoint.instanceId}:${endpoint.pinName}`
    : `j:${endpoint.junctionId}`;
}

/** Where two straight segments lie along one line over each other, if they do. */
function collinearOverlap(
  [a1, a2]: [Point, Point],
  [b1, b2]: [Point, Point],
): Point[] | null {
  const horizontal = a1.y === a2.y && b1.y === b2.y && a1.y === b1.y;
  const vertical = a1.x === a2.x && b1.x === b2.x && a1.x === b1.x;
  if (!horizontal && !vertical) return null;
  const axis = horizontal ? "x" : "y";
  const low = Math.max(
    Math.min(a1[axis], a2[axis]),
    Math.min(b1[axis], b2[axis]),
  );
  const high = Math.min(
    Math.max(a1[axis], a2[axis]),
    Math.max(b1[axis], b2[axis]),
  );
  if (high - low <= 0) return null;
  return horizontal
    ? [
        { x: low, y: a1.y },
        { x: high, y: a1.y },
      ]
    : [
        { x: a1.x, y: low },
        { x: a1.x, y: high },
      ];
}

function deviceFindings(
  document: SchematicDocument,
  resolver: ReturnType<typeof createProjectSymbolResolver>,
): LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  const placed = document.instances.filter(
    (instance) => instance.placement && familyOf(instance.symbolId),
  );
  const name = (instance: (typeof placed)[number]) =>
    instance.reference ?? instance.id;
  // Same-family neighbours whose pins miss a shared column or row by a
  // grid step: a drain over a source, a gate beside a gate.
  const pinsOf = new Map(
    placed.map((instance) => {
      const pins = resolver.resolve(instance.symbolId)?.definition.pins ?? [];
      const at = pins.flatMap((pin) => {
        const contact = resolveEndpointConnection(document, resolver, {
          kind: "terminal",
          instanceId: instance.id,
          pinName: pin.name,
        });
        return contact?.outward
          ? [{ point: contact.contactPoint, outward: contact.outward }]
          : [];
      });
      return [instance.id, at] as const;
    }),
  );
  const nearest = (
    a: (typeof placed)[number],
    b: (typeof placed)[number],
    vertical: boolean,
  ) => {
    let best = Infinity;
    for (const p of pinsOf.get(a.id) ?? [])
      for (const q of pinsOf.get(b.id) ?? []) {
        const along = vertical ? p.outward.y !== 0 : p.outward.x !== 0;
        const alongToo = vertical ? q.outward.y !== 0 : q.outward.x !== 0;
        if (!along || !alongToo) continue;
        best = Math.min(
          best,
          Math.round(
            Math.abs(vertical ? p.point.x - q.point.x : p.point.y - q.point.y),
          ),
        );
      }
    return best;
  };
  for (let a = 0; a < placed.length; a += 1)
    for (let b = a + 1; b < placed.length; b += 1) {
      const first = placed[a]!;
      const second = placed[b]!;
      // Alike and turned alike: a device turned on its side (a MOS
      // varactor beside a pair) keeps its pins elsewhere.
      if (
        familyOf(first.symbolId) !== familyOf(second.symbolId) ||
        first.placement!.rotation !== second.placement!.rotation
      )
        continue;
      const p = first.placement!.position;
      const q = second.placement!.position;
      const dx = Math.abs(p.x - q.x);
      const dy = Math.abs(p.y - q.y);
      if (dy >= 40 && dy <= 160 && dx <= 40) {
        const miss = nearest(first, second, true);
        if (miss >= MISS.min && miss <= MISS.max)
          findings.push({
            kind: "near-column",
            message: `${name(first)} and ${name(second)} are stacked, their pins ${miss} units out of one column.`,
            box: around([p, q], 30),
            devices: [name(first), name(second)],
          });
      } else if (dx >= 40 && dx <= 200 && dy <= 40) {
        const miss = nearest(first, second, false);
        if (miss >= MISS.min && miss <= MISS.max)
          findings.push({
            kind: "near-row",
            message: `${name(first)} and ${name(second)} sit side by side, their pins ${miss} units off one row.`,
            box: around([p, q], 30),
            devices: [name(first), name(second)],
          });
      }
    }
  // Twins by what they connect to, as the drawing wires them (no netlist
  // export needed: a drawing still missing values has its structure), drawn
  // not as mirror images.
  const logical = resolveDocumentLogicalNets(document);
  const byId = new Map(document.instances.map((each) => [each.id, each]));
  const supplies = new Map<string, string>();
  const wiredPins = new Map<string, { role: string; net: string }[]>();
  for (const net of document.nets) {
    const id = logical.byBaseNetId.get(net.id)?.id ?? net.id;
    for (const terminal of net.terminals) {
      const symbol = byId.get(terminal.instanceId)?.symbolId;
      if (symbol === "ground") supplies.set(id, "#gnd");
      else if (symbol === "vdd-port" && !supplies.has(id))
        supplies.set(id, "#vdd");
      const role = pinRole(symbol ?? "", terminal.pinName);
      if (role)
        wiredPins.set(terminal.instanceId, [
          ...(wiredPins.get(terminal.instanceId) ?? []),
          { role, net: id },
        ]);
    }
  }
  const devices: NetlistDevice[] = document.instances.flatMap((instance) => {
    const kind = KIND[instance.symbolId];
    const pins = wiredPins.get(instance.id);
    return kind && pins
      ? [
          {
            name: instance.id,
            kind,
            line: 0,
            pins: pins.map((pin) => ({
              role: pin.role,
              net: supplies.get(pin.net) ?? pin.net,
            })),
          },
        ]
      : [];
  });
  for (const [left, right] of structuralTwins(devices)) {
    const a = byId.get(left.name);
    const b = byId.get(right.name);
    if (!a?.placement || !b?.placement) continue;
    if (familyOf(a.symbolId) !== "mos" && familyOf(a.symbolId) !== "bjt")
      continue;
    const p = a.placement;
    const q = b.placement;
    const upright = p.rotation % 180 === 0;
    const offset = upright
      ? Math.abs(p.position.y - q.position.y)
      : Math.abs(p.position.x - q.position.x);
    // Far apart, they are on different rows by design.
    if (offset > TWIN_ROWS) continue;
    const offAxis = offset > 0;
    const flipped = (mirror: string) =>
      mirror === "horizontal" || mirror === "both";
    const mirrored =
      p.rotation === q.rotation && flipped(p.mirror) !== flipped(q.mirror);
    if (!offAxis && mirrored) continue;
    findings.push({
      kind: "asymmetric-pair",
      message: `${name(a)} and ${name(b)} are twins in the circuit but ${
        offAxis
          ? upright
            ? `not level (${Math.abs(p.position.y - q.position.y)} units apart in height)`
            : "not in line"
          : "not drawn as mirror images"
      }.`,
      box: around([p.position, q.position], 34),
      devices: [name(a), name(b)],
    });
  }
  return findings;
}

/** How many findings of each kind, for a summary line. */
export function countFindings(
  findings: readonly LayoutFinding[],
): Partial<Record<LayoutCheckKind, number>> {
  const counts: Partial<Record<LayoutCheckKind, number>> = {};
  for (const finding of findings)
    counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
  return counts;
}

/** The findings of a stored Project's text, or none when it does not parse. */
export function checkLayoutText(projectText: string): LayoutFinding[] {
  try {
    return checkLayout(parseProject(projectText));
  } catch {
    return [];
  }
}
