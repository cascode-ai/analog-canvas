/**
 * A block's supplies, drawn when an Instance shows them (#1833, #1941): VDD
 * above and VSS below, each on a lead from the body's edge to a pin on the
 * connection grid, so a wire leaves clear of the body. The default variant
 * hides both pins and leads, so a drawing looks as the textbook draws it; the
 * netlist meets each supply either way. They follow every other pin and
 * primitive, so a form derived from a block keeps its own drawing first.
 */
const SUPPLY_ROLES = new Set(["positive-supply", "negative-supply"]);
const SUPPLY_LEAD_PARTS = { VDD: "vdd-lead", VSS: "vss-lead" };
const SIGNAL_PINS_VARIANT = "signal-pins";
const SUPPLY_PINS_VARIANT = "supply-pins";

const GRID = 10;
const SUPPLY_LEAD_LENGTH = 10;
const round = (value) => Number(value.toFixed(6)) + 0;

/**
 * `symbol` with VDD at `vdd.at` and VSS at `vss.at`, each on a lead from its
 * `contact` on the body. Both pins leave vertically: VDD north, VSS south.
 */
export function withSupplyPins(symbol, { vdd, vss }) {
  if (symbol.pins.some((pin) => SUPPLY_ROLES.has(pin.role)))
    throw new Error(`${symbol.id} already draws its supplies`);
  if (symbol.variants.length || symbol.defaultVariantId)
    throw new Error(`${symbol.id} has variants of its own`);
  const supplies = [
    ["VDD", "positive-supply", "north", vdd],
    ["VSS", "negative-supply", "south", vss],
  ];
  for (const [name, , direction, { at, contact }] of supplies) {
    if (at.x % GRID !== 0 || at.y % GRID !== 0)
      throw new Error(`${symbol.id}.${name} is off the connection grid`);
    if (
      contact.x !== at.x ||
      (direction === "north" ? contact.y <= at.y : contact.y >= at.y)
    )
      throw new Error(`${symbol.id}.${name} does not leave its body`);
  }
  return {
    ...symbol,
    pins: [
      ...symbol.pins,
      ...supplies.map(([name, role, direction, { at }]) => ({
        name,
        role,
        at,
        direction,
        presentation: {
          visibility: "visible",
          leadLength: SUPPLY_LEAD_LENGTH,
        },
      })),
    ],
    primitives: [
      ...symbol.primitives,
      ...supplies.map(([name, , , { at, contact }]) => ({
        kind: "line",
        from: { x: contact.x, y: round(contact.y) },
        to: at,
        style: { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" },
        part: SUPPLY_LEAD_PARTS[name],
      })),
    ],
    variants: [
      {
        id: SIGNAL_PINS_VARIANT,
        hiddenPinNames: ["VDD", "VSS"],
        hiddenPrimitiveParts: Object.values(SUPPLY_LEAD_PARTS),
        additionalPrimitives: [],
      },
      {
        id: SUPPLY_PINS_VARIANT,
        hiddenPinNames: [],
        hiddenPrimitiveParts: [],
        additionalPrimitives: [],
      },
    ],
    defaultVariantId: SIGNAL_PINS_VARIANT,
  };
}

/** `symbol` as it is drawn without its supplies: its own pins and art. */
export function withoutSupplyPins(symbol) {
  const leads = new Set(Object.values(SUPPLY_LEAD_PARTS));
  const { defaultVariantId: _default, ...rest } = symbol;
  return {
    ...rest,
    pins: symbol.pins.filter((pin) => !SUPPLY_ROLES.has(pin.role)),
    primitives: symbol.primitives.filter(
      (primitive) => !leads.has(primitive.part),
    ),
    variants: symbol.variants.filter(
      (variant) =>
        variant.id !== SIGNAL_PINS_VARIANT &&
        variant.id !== SUPPLY_PINS_VARIANT,
    ),
  };
}

/** Points along a cubic, line or arc outline, finely enough to find an edge. */
function outlinePoints(primitive) {
  const steps = 512;
  const segment = (from, to) =>
    Array.from({ length: steps + 1 }, (_, index) => ({
      x: from.x + ((to.x - from.x) * index) / steps,
      y: from.y + ((to.y - from.y) * index) / steps,
    }));
  if (primitive.kind === "polygon")
    return primitive.points.flatMap((point, index, points) =>
      segment(point, points[(index + 1) % points.length]),
    );
  if (primitive.kind === "circle")
    return Array.from({ length: 4 * steps }, (_, index) => {
      const angle = (index * Math.PI) / (2 * steps);
      return {
        x: primitive.center.x + primitive.radius * Math.cos(angle),
        y: primitive.center.y + primitive.radius * Math.sin(angle),
      };
    });
  if (primitive.kind !== "path")
    throw new Error(`A ${primitive.kind} has no outline to meet`);
  const tokens =
    primitive.data.match(/[MLCZ]|[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/giu) ?? [];
  const points = [];
  let cursor;
  let start;
  let command;
  const read = () => ({ x: Number(tokens.shift()), y: Number(tokens.shift()) });
  while (tokens.length) {
    if (/^[MLCZ]$/iu.test(tokens[0])) command = tokens.shift().toUpperCase();
    if (command === "M") {
      cursor = start = read();
      command = "L";
    } else if (command === "L") {
      const to = read();
      points.push(...segment(cursor, to));
      cursor = to;
    } else if (command === "C") {
      const [a, b, to] = [read(), read(), read()];
      for (let index = 0; index <= steps; index++) {
        const t = index / steps;
        const u = 1 - t;
        points.push({
          x: u ** 3 * cursor.x + 3 * u ** 2 * t * a.x + 3 * u * t ** 2 * b.x,
          y: u ** 3 * cursor.y + 3 * u ** 2 * t * a.y + 3 * u * t ** 2 * b.y,
        });
        points.at(-1).x += t ** 3 * to.x;
        points.at(-1).y += t ** 3 * to.y;
      }
      cursor = to;
    } else if (command === "Z") {
      points.push(...segment(cursor, start));
      cursor = start;
      command = undefined;
    } else throw new Error(`Unsupported outline command ${command}`);
  }
  return points;
}

/**
 * Where a vertical line at `x` meets the top and bottom of a body outline,
 * read from its own geometry: the lead's contact with the body.
 */
function bodyEdgeAt(body, x) {
  const points = outlinePoints(body);
  const crossings = [];
  for (let index = 1; index < points.length; index++) {
    const [a, b] = [points[index - 1], points[index]];
    if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) {
      if (a.x === x) crossings.push(a.y);
      continue;
    }
    crossings.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
  }
  if (!crossings.length) throw new Error(`No body edge at x ${x}`);
  return {
    top: round(Math.min(...crossings)),
    bottom: round(Math.max(...crossings)),
  };
}

/**
 * VDD at `vdd` and VSS at `vss`, each on a lead from where a vertical line
 * through it meets `body`'s top or bottom edge.
 */
export function supplyPinsOn(body, vdd, vss) {
  return {
    vdd: { at: vdd, contact: { x: vdd.x, y: bodyEdgeAt(body, vdd.x).top } },
    vss: { at: vss, contact: { x: vss.x, y: bodyEdgeAt(body, vss.x).bottom } },
  };
}

/** Where `symbol` draws its supplies, for a form derived from it to keep. */
export function supplyPinsOf(symbol) {
  const placement = (name) => {
    const pin = symbol.pins.find((candidate) => candidate.name === name);
    const lead = symbol.primitives.find(
      (primitive) => primitive.part === SUPPLY_LEAD_PARTS[name],
    );
    if (!pin || !lead) throw new Error(`${symbol.id} draws no ${name}`);
    return { at: structuredClone(pin.at), contact: structuredClone(lead.from) };
  };
  return { vdd: placement("VDD"), vss: placement("VSS") };
}
