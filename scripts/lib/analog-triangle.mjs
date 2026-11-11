/**
 * Product normalization requested for triangular Analog Blocks: three equal
 * 60-unit sides and a 60-degree apex. PDF extracts remain source evidence;
 * the generated product outline uses this shared construction instead.
 * Anchor the vertical base to the connection grid; the irrational altitude
 * belongs at the apex, not at the edge shared by the inputs.
 * Inputs stay at -40. Outputs share +30: single-ended pins retract one
 * 10-unit grid step from +40, differential pins extend one from +20.
 */
export const ANALOG_TRIANGLE = {
  leftX: -30,
  apexX: Number((-30 + 30 * Math.sqrt(3)).toFixed(6)),
  apexY: 0,
  topY: -30,
  bottomY: 30,
};

export const ANALOG_TRIANGLE_OUTPUT_X = 30;

export const ANALOG_TRIANGLE_PATH =
  `M ${ANALOG_TRIANGLE.leftX} ${ANALOG_TRIANGLE.topY}` +
  ` L ${ANALOG_TRIANGLE.leftX} ${ANALOG_TRIANGLE.bottomY}` +
  ` L ${ANALOG_TRIANGLE.apexX} ${ANALOG_TRIANGLE.apexY} Z`;

export const ANALOG_TRIANGLE_BOUNDS = {
  x: ANALOG_TRIANGLE.leftX,
  y: ANALOG_TRIANGLE.topY,
  width: ANALOG_TRIANGLE.apexX - ANALOG_TRIANGLE.leftX,
  height: ANALOG_TRIANGLE.bottomY - ANALOG_TRIANGLE.topY,
};

/**
 * VDD and VSS at `x` when an Instance shows them (#1833, #1941): on the
 * body's extent, each on a lead from where the slanted edge crosses `x`.
 */
export function analogTriangleSupplyPins(x) {
  const contactY = Number(
    (
      ((ANALOG_TRIANGLE.apexX - x) /
        (ANALOG_TRIANGLE.apexX - ANALOG_TRIANGLE.leftX)) *
      ANALOG_TRIANGLE.bottomY
    ).toFixed(6),
  );
  return {
    vdd: { at: { x, y: ANALOG_TRIANGLE.topY }, contact: { x, y: -contactY } },
    vss: { at: { x, y: ANALOG_TRIANGLE.bottomY }, contact: { x, y: contactY } },
  };
}

/** A single-ended form's: at x 0, 30 - 10√3 from the slanted edges. */
export const ANALOG_TRIANGLE_SUPPLY_PINS = analogTriangleSupplyPins(0);

/**
 * A compact differential form's outputs leave the slanted edges a grid row
 * either side of the axis, so its supplies stand one grid column further
 * back, clear of where they leave.
 */
export const DIFFERENTIAL_TRIANGLE_SUPPLY_PINS = analogTriangleSupplyPins(-10);

export const ANALOG_TRIANGLE_VIEWBOX = {
  x: -44,
  y: -34,
  width: 88,
  height: 68,
};
