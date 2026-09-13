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
