/**
 * Product normalization requested for triangular Analog Blocks: three equal
 * 50-unit sides and a 60-degree apex. PDF extracts remain source evidence;
 * the generated product outline uses this shared construction instead.
 * The existing ±40 single-output and +20 differential-output pins stay fixed.
 */
export const ANALOG_TRIANGLE = {
  leftX: Number((20 - 25 * Math.sqrt(3)).toFixed(6)),
  apexX: 20,
  apexY: 0,
  topY: -25,
  bottomY: 25,
};

export const ANALOG_TRIANGLE_PATH =
  `M ${ANALOG_TRIANGLE.leftX} ${ANALOG_TRIANGLE.topY}` +
  ` L ${ANALOG_TRIANGLE.leftX} ${ANALOG_TRIANGLE.bottomY}` +
  ` L ${ANALOG_TRIANGLE.apexX} ${ANALOG_TRIANGLE.apexY} Z`;

export const ANALOG_TRIANGLE_VIEWBOX = {
  x: -44,
  y: -28,
  width: 88,
  height: 56,
};
