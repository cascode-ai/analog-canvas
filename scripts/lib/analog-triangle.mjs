/**
 * Product normalization requested for triangular Analog Blocks: three equal
 * 60-unit sides and a 60-degree apex. PDF extracts remain source evidence;
 * the generated product outline uses this shared construction instead.
 * Inputs stay at -40. Outputs share +30: single-ended pins retract one
 * 10-unit grid step from +40, differential pins extend one from +20.
 */
export const ANALOG_TRIANGLE = {
  leftX: Number((25 - 30 * Math.sqrt(3)).toFixed(6)),
  apexX: 25,
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

export const ANALOG_TRIANGLE_VIEWBOX = {
  x: -44,
  y: -34,
  width: 88,
  height: 68,
};
