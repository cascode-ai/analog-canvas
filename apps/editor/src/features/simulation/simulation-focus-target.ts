import type { SimulationExpression } from "@icm/model";

/** A chart output id plus its canonical Canvas expression, not a stored probe protocol. */
export type SimulationFocusTarget = { id: string } & Extract<
  SimulationExpression,
  { kind: "voltage" | "current" }
>;
