import { describe, expect, it } from "vitest";

import {
  parseSimulationExpression,
  simulationExpressionDependencies,
} from "./simulation-expression.js";
import type { SimulationExpression } from "./schema/simulation.js";

const vin: SimulationExpression = {
  kind: "voltage",
  documentId: "tb",
  anchor: { kind: "base-net", netId: "in" },
  occurrence: [],
};
const vout: SimulationExpression = {
  kind: "voltage",
  documentId: "tb",
  anchor: { kind: "base-net", netId: "out" },
  occurrence: [],
};

describe("simulation expression parser", () => {
  it("binds names to stable leaves and honors arithmetic precedence", () => {
    const result = parseSimulationExpression(
      "db20(Vout / Vin) + 3",
      new Map([
        ["Vin", vin],
        ["Vout", vout],
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expression.kind).toBe("add");
    expect(simulationExpressionDependencies(result.expression)).toEqual([
      vout,
      vin,
    ]);
  });

  it("returns a recoverable located error for unknown names", () => {
    expect(
      parseSimulationExpression("Vout / Missing", new Map([["Vout", vout]])),
    ).toMatchObject({ ok: false, code: "UNKNOWN_SYMBOL", offset: 7 });
  });
});
