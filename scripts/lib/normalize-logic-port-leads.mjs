const CONNECTION_GRID = 10;

function samePoint(left, right) {
  return left.x === right.x && left.y === right.y;
}

function snapToConnectionGrid(value) {
  return Math.round(value / CONNECTION_GRID) * CONNECTION_GRID;
}

/**
 * Keeps source-calibrated logic artwork intact while shortening each external
 * horizontal lead to the closest grid-aligned approximation of one grid cell.
 */
export function normalizeLogicPortLeads(definition) {
  for (const pin of definition.pins) {
    if (pin.direction !== "west" && pin.direction !== "east") continue;

    const attached = definition.primitives.filter(
      (primitive) =>
        primitive.kind === "line" &&
        (samePoint(primitive.from, pin.at) || samePoint(primitive.to, pin.at)),
    );
    if (attached.length !== 1) {
      throw new Error(
        `Logic symbol ${definition.id} pin ${pin.name} must own exactly one external lead`,
      );
    }

    const lead = attached[0];
    const pinStartsLead = samePoint(lead.from, pin.at);
    const bodyContact = pinStartsLead ? lead.to : lead.from;
    const outwardSign = pin.direction === "west" ? -1 : 1;
    const nextPin = {
      x: snapToConnectionGrid(bodyContact.x + outwardSign * CONNECTION_GRID),
      y: pin.at.y,
    };

    pin.at = nextPin;
    pin.presentation = {
      ...pin.presentation,
      leadLength: CONNECTION_GRID,
    };
    if (pinStartsLead) lead.from = { ...nextPin };
    else lead.to = { ...nextPin };
  }

  return definition;
}
