const GRID = 10;
const BODY_LEFT = -20;
const MIN_OUTPUT_LEAD = 4;
const rounded = (value) => Number(value.toFixed(6));
const numbers = /-?\d+(?:\.\d+)?/gu;

/** The reviewed gate paths use absolute M/L/C coordinates only. */
function pathPoints(data) {
  if (/[a-zA-BD-KN-Y]/u.test(data))
    throw new Error(
      "Left-anchored gate normalization requires absolute M/L/C/Z paths",
    );
  const coordinates = [...data.matchAll(numbers)].map((match) =>
    Number(match[0]),
  );
  if (coordinates.length === 0 || coordinates.length % 2)
    throw new Error("Gate path must contain coordinate pairs");
  return coordinates
    .filter((_, index) => index % 2 === 0)
    .map((x, index) => ({ x, y: coordinates[index * 2 + 1] }));
}

/**
 * The PDF records the straight and curved halves of AND/NAND as separate
 * strokes. Their endpoints differ slightly, so independently stroking them
 * leaves a visible step at high zoom. Join only those two body contours in the
 * product projection; the original vector evidence remains untouched.
 */
export function closeSplitGateBody(definition) {
  if (!["and-gate", "nand-gate"].includes(definition.id)) return definition;
  const indices = definition.primitives.flatMap((primitive, index) =>
    primitive.kind === "path" ? [index] : [],
  );
  if (indices.length !== 2 || indices[1] !== indices[0] + 1) {
    throw new Error(
      `${definition.id} needs adjacent straight and curved body paths`,
    );
  }
  const straight = definition.primitives[indices[0]];
  const curve = definition.primitives[indices[1]];
  if (
    !/^M(?:\s+-?\d+(?:\.\d+)?){2}(?:\s+L(?:\s+-?\d+(?:\.\d+)?){2}){3}$/u.test(
      straight.data,
    ) ||
    !/^M(?:\s+-?\d+(?:\.\d+)?){2}(?:\s+C(?:\s+-?\d+(?:\.\d+)?){6})+$/u.test(
      curve.data,
    )
  ) {
    throw new Error(
      `${definition.id} body no longer has the reviewed M/L and M/C shapes`,
    );
  }
  const linePoints = pathPoints(straight.data);
  const curvePoints = pathPoints(curve.data);
  if (
    linePoints.length !== 4 ||
    (curvePoints.length - 1) % 3 !== 0 ||
    JSON.stringify(straight.style) !== JSON.stringify(curve.style)
  ) {
    throw new Error(`${definition.id} body paths cannot be joined safely`);
  }
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const start = linePoints[0];
  const end = linePoints[3];
  if (
    distance(start, curvePoints[0]) > 0.25 ||
    distance(end, curvePoints.at(-1)) > 0.25
  ) {
    throw new Error(
      `${definition.id} body endpoints have drifted beyond the seam tolerance`,
    );
  }
  // Repeated endpoint controls should move with the endpoint; all interior
  // Bézier controls and the straight outline retain the extracted geometry.
  for (const index of [1, 2]) {
    if (distance(curvePoints[index], curvePoints[0]) < 0.000001) {
      curvePoints[index] = start;
    }
  }
  for (const index of [curvePoints.length - 3, curvePoints.length - 2]) {
    if (distance(curvePoints[index], curvePoints.at(-1)) < 0.000001) {
      curvePoints[index] = end;
    }
  }
  if (definition.id === "and-gate") {
    // The extracted arc initially rises 0.157 units above the flat top. Its
    // first two tiny cubics must meet that top tangentially, not leave a tooth.
    for (let index = 1; index < curvePoints.length; index++) {
      const control = curvePoints[index];
      if (control.x > start.x + 0.7) break;
      if (control.y < start.y && start.y - control.y < 0.25) {
        curvePoints[index] = { ...control, y: start.y };
      }
    }
  }
  curvePoints[curvePoints.length - 1] = end;
  const point = ({ x, y }) => `${x} ${y}`;
  const cubics = [];
  for (let index = 1; index < curvePoints.length; index += 3) {
    cubics.push(
      `C ${curvePoints
        .slice(index, index + 3)
        .map(point)
        .join(" ")}`,
    );
  }
  const data = [
    `M ${point(start)}`,
    ...cubics,
    ...linePoints
      .slice(1, -1)
      .reverse()
      .map((value) => `L ${point(value)}`),
    "Z",
  ].join(" ");
  definition.primitives.splice(indices[0], 2, { ...curve, data });
  return definition;
}

/**
 * Anchor the product's left outline first, preserving the source shape and
 * scale. Pins and their short leads are then rebuilt from that artwork.
 * Original PDF evidence is never rewritten to claim this product placement.
 */
export function anchorLogicBody(definition) {
  const paths = definition.primitives.filter(
    (primitive) => primitive.kind === "path",
  );
  const sourceLeft = Math.min(
    ...paths.flatMap((path) => pathPoints(path.data).map((point) => point.x)),
  );
  if (!Number.isFinite(sourceLeft))
    throw new Error(`${definition.id} has no gate body`);
  const dx = BODY_LEFT - sourceLeft;
  const translate = (point) => ({ x: rounded(point.x + dx), y: point.y });
  for (const primitive of definition.primitives) {
    if (primitive.kind === "path") {
      let index = 0;
      primitive.data = primitive.data.replace(numbers, (token) => {
        const value = Number(token);
        return String(index++ % 2 === 0 ? rounded(value + dx) : value);
      });
      const points = pathPoints(primitive.data);
      const xs = points.map((point) => point.x),
        ys = points.map((point) => point.y);
      // The control polygon encloses every cubic segment and follows the body
      // instead of falling back to the source crop's generous whitespace.
      primitive.bounds = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: rounded(Math.max(...xs) - Math.min(...xs)),
        height: rounded(Math.max(...ys) - Math.min(...ys)),
      };
    } else if (primitive.kind === "line") {
      primitive.from = translate(primitive.from);
      primitive.to = translate(primitive.to);
    } else if (primitive.kind === "circle") {
      primitive.center = translate(primitive.center);
    } else
      throw new Error(
        `${definition.id}: unsupported gate primitive ${primitive.kind}`,
      );
  }
  for (const pin of definition.pins) pin.at = translate(pin.at);
  const straightInput = [
    "buffer",
    "inverter",
    "and-gate",
    "nand-gate",
  ].includes(definition.id);
  const bubble = definition.primitives.find(
    (primitive) => primitive.part === "negation-bubble",
  );
  for (const pin of definition.pins) {
    const equals = (point) => point.x === pin.at.x && point.y === pin.at.y;
    const leads = definition.primitives.filter(
      (primitive) =>
        primitive.kind === "line" &&
        (equals(primitive.from) || equals(primitive.to)),
    );
    if (leads.length !== 1)
      throw new Error(`${definition.id}.${pin.name} must own one lead`);
    const lead = leads[0];
    const startsAtPin = equals(lead.from);
    const contact = startsAtPin ? lead.to : lead.from;
    if (pin.direction === "west") {
      pin.at.x = BODY_LEFT - GRID;
      if (straightInput) contact.x = BODY_LEFT;
    } else if (pin.direction === "east") {
      if (bubble?.kind === "circle")
        contact.x = rounded(bubble.center.x + bubble.radius);
      // Avoid a nearly invisible stub when a bubble ends just before a grid
      // point. Keep its exact edge, then choose the first usable connection.
      pin.at.x = Math.ceil((contact.x + MIN_OUTPUT_LEAD) / GRID) * GRID;
    } else
      throw new Error(`${definition.id}.${pin.name} must face east or west`);
    contact.y = pin.at.y;
    if (startsAtPin) lead.from = { ...pin.at };
    else lead.to = { ...pin.at };
    pin.presentation.leadLength = Math.round(Math.abs(pin.at.x - contact.x));
  }
  return definition;
}
