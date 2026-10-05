/**
 * Netlist findings that belong to the netlist review alone: an unnamed node
 * exported under a generated name, a MOS body taking its Cell's conventional
 * supply, which is what a simulator assumes anyway, and a ground pin named
 * GND because the Cell calls another Net VSS, which the deck wires as drawn.
 * A run listed `GENERATED_NET_NAME` for every unnamed node until it was
 * dropped, and would list a body default for every MOS with no body drawn.
 * `MOS_BODY_OTHER_SUPPLY` stays: a body on another supply than its source
 * can forward-bias a junction and make the run's results unphysical.
 */
const REVIEW_ONLY_CODES = new Set([
  "GENERATED_NET_NAME",
  "GROUND_PIN_RENAMED",
  "MOS_BODY_DEFAULT_SUPPLY",
]);

/** The messages of the netlist findings a run shows. */
export function netlistRunWarnings(
  diagnostics: readonly { code: string; message: string }[],
): string[] {
  return diagnostics
    .filter((item) => !REVIEW_ONLY_CODES.has(item.code))
    .map((item) => item.message);
}
