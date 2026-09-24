const curvedGateIds = new Set(["or-gate", "nor-gate", "xor-gate", "xnor-gate"]);
const supportedGateIds = new Set(["nand-gate", ...curvedGateIds]);

function cubicPoint(from, controlA, controlB, to, t) {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * from.x +
      3 * inverse ** 2 * t * controlA.x +
      3 * inverse * t ** 2 * controlB.x +
      t ** 3 * to.x,
    y:
      inverse ** 3 * from.y +
      3 * inverse ** 2 * t * controlA.y +
      3 * inverse * t ** 2 * controlB.y +
      t ** 3 * to.y,
  };
}

/** Read the reviewed M/C contours; no reconstructed curve replaces the source. */
function cubicSegments(path) {
  const tokens = path.match(/[MC]|-?\d+(?:\.\d+)?/g) ?? [];
  const segments = [];
  let cursor = { x: 0, y: 0 };
  for (let index = 0; index < tokens.length;) {
    const command = tokens[index++];
    if (command === "M") {
      cursor = { x: Number(tokens[index++]), y: Number(tokens[index++]) };
      continue;
    }
    if (command !== "C")
      throw new Error(`Unsupported logic contour: ${command}`);
    while (
      index < tokens.length &&
      tokens[index] !== "M" &&
      tokens[index] !== "C"
    ) {
      const controlA = {
        x: Number(tokens[index++]),
        y: Number(tokens[index++]),
      };
      const controlB = {
        x: Number(tokens[index++]),
        y: Number(tokens[index++]),
      };
      const to = { x: Number(tokens[index++]), y: Number(tokens[index++]) };
      segments.push({ from: cursor, controlA, controlB, to });
      cursor = to;
    }
  }
  return segments;
}

function rearContourX(path, y) {
  const intersections = [];
  for (const segment of cubicSegments(path)) {
    let previous = segment.from;
    for (let step = 1; step <= 256; step++) {
      const current = cubicPoint(
        segment.from,
        segment.controlA,
        segment.controlB,
        segment.to,
        step / 256,
      );
      if (
        (previous.y <= y && y <= current.y) ||
        (current.y <= y && y <= previous.y)
      ) {
        if (current.y !== previous.y) {
          const fraction = (y - previous.y) / (current.y - previous.y);
          intersections.push(previous.x + fraction * (current.x - previous.x));
        }
      }
      previous = current;
    }
  }
  if (intersections.length === 0)
    throw new Error(`Logic rear contour does not cross y=${y}`);
  return Math.min(...intersections);
}

/** Fixed-body house arities, generated from each reviewed two-input Symbol. */
export function deriveMultiInputLogicGate(source, inputCount) {
  const base = source?.symbol;
  if (!supportedGateIds.has(base?.id) || ![3, 4].includes(inputCount))
    throw new Error(
      "Expected a supported two-input logic gate and 3 or 4 inputs",
    );
  const [topLead, bottomLead, ...body] = base.primitives;
  if (topLead?.kind !== "line" || bottomLead?.kind !== "line")
    throw new Error(`${base.id}: expected two input lead lines`);
  const curve = curvedGateIds.has(base.id)
    ? base.primitives[base.id.startsWith("x") ? 3 : 2]
    : null;
  if (curve && curve.kind !== "path")
    throw new Error(`${base.id}: missing rear contour`);
  const inputYs = inputCount === 3 ? [-10, 0, 10] : [-12, -4, 4, 12];
  const pins = inputYs.map((y, index) => ({
    ...structuredClone(base.pins[0]),
    name: "ABCD"[index],
    at: { x: -30, y },
  }));
  pins.push(structuredClone(base.pins.at(-1)));
  const leads = inputYs.map((y) => ({
    ...structuredClone(topLead),
    from: { x: -30, y },
    // A sub-unit overlap is hidden under the body stroke and prevents a raster
    // seam while leaving the reviewed outline itself completely unchanged.
    to: {
      x: curve ? Number((rearContourX(curve.data, y) + 0.25).toFixed(6)) : -20,
      y,
    },
  }));
  return {
    ...structuredClone(base),
    id: `${base.id}-${inputCount}`,
    name: `${base.name} (${inputCount} inputs)`,
    pins,
    primitives: [...leads, ...structuredClone(body)],
  };
}
