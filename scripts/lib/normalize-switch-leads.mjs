const CONNECTION_GRID = 10;

function samePoint(left, right) {
  return left.x === right.x && left.y === right.y;
}

/**
 * Pull every external switch lead in to exactly one grid cell.
 *
 * This is deliberately NOT `normalizeLogicPortLeads`. That helper snaps the
 * connection point *outward*, so a body whose contact lands on a half-grid —
 * a D flip-flop edge, and every switch — keeps a 1.5-cell lead. For the logic
 * family that is the documented intent and the library is full of the 15s it
 * produces. A switch is a different shape: its contacts sit at roughly ±13 to
 * ±15, and rounding outward leaves the anchor at ±30, which is where the long
 * stubs came from. Snapping inward puts the anchor a true cell out.
 *
 * The body is never touched. Only the anchor and the lead segment that runs
 * to it move, so the Razavi-calibrated blade and contact circles are exactly
 * as extracted.
 */
export function normalizeSwitchLeads(definition) {
  for (const pin of definition.pins) {
    if (pin.direction !== "west" && pin.direction !== "east") continue;

    const attached = definition.primitives.filter(
      (primitive) =>
        primitive.kind === "line" &&
        (samePoint(primitive.from, pin.at) || samePoint(primitive.to, pin.at)),
    );
    if (attached.length !== 1) {
      throw new Error(
        `Switch ${definition.id} pin ${pin.name} must own exactly one external lead`,
      );
    }

    const lead = attached[0];
    const pinStartsLead = samePoint(lead.from, pin.at);
    const bodyContact = pinStartsLead ? lead.to : lead.from;
    const outwardSign = pin.direction === "west" ? -1 : 1;
    // Round the contact to the grid cell it sits inside, then step one cell
    // out. Rounding rather than flooring outward is the whole difference.
    const nominalBodyX =
      Math.round(bodyContact.x / CONNECTION_GRID) * CONNECTION_GRID;
    const connectionX = nominalBodyX + outwardSign * CONNECTION_GRID;

    const nextPin = { x: connectionX, y: pin.at.y };
    pin.at = nextPin;
    pin.presentation = { ...pin.presentation, leadLength: CONNECTION_GRID };
    if (pinStartsLead) lead.from = { ...nextPin };
    else lead.to = { ...nextPin };
  }
  return definition;
}
