const CONNECTION_GRID = 10;

function samePoint(left, right) {
  return left.x === right.x && left.y === right.y;
}

function snapToHalfGrid(value) {
  const halfGrid = CONNECTION_GRID / 2;
  return Math.round(value / halfGrid) * halfGrid;
}

function outerConnectionPoint(bodyContactX, outwardSign) {
  const nominalBodyContactX = snapToHalfGrid(bodyContactX);
  const oneCellOut = nominalBodyContactX + outwardSign * CONNECTION_GRID;
  const connectionX =
    outwardSign < 0
      ? Math.floor(oneCellOut / CONNECTION_GRID) * CONNECTION_GRID
      : Math.ceil(oneCellOut / CONNECTION_GRID) * CONNECTION_GRID;
  return {
    connectionX,
    nominalLeadLength: Math.abs(connectionX - nominalBodyContactX),
  };
}

/**
 * Keeps source-calibrated logic artwork intact while shortening each external
 * horizontal lead to one grid cell. A body contact on a half-grid, such as a
 * DFF edge, continues to the following connection point for a 1.5-cell lead.
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
    const { connectionX, nominalLeadLength } = outerConnectionPoint(
      bodyContact.x,
      outwardSign,
    );
    const nextPin = {
      x: connectionX,
      y: pin.at.y,
    };

    pin.at = nextPin;
    pin.presentation = {
      ...pin.presentation,
      leadLength: nominalLeadLength,
    };
    if (pinStartsLead) lead.from = { ...nextPin };
    else lead.to = { ...nextPin };
  }

  return definition;
}
