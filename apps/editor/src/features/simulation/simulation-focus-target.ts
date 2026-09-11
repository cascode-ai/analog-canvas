import type { SimulationPresentationExpression } from "./source-presentation";

/** A chart output id plus its canonical Canvas expression, not a stored probe protocol. */
export type SimulationFocusTarget = { id: string } & Extract<
  SimulationPresentationExpression,
  { kind: "voltage" | "current" }
>;
