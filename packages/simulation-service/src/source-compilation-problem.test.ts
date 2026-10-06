import { createSimulationFolder } from "@icm/model";
import type { SimulationSourceDiagnostic } from "@icm/netlist";
import { describe, expect, it } from "vitest";

import { sourceCompilationProblem } from "./source-compilation-problem.js";

describe("a refused preparation", () => {
  it("lists blocking errors first, then warnings, then notes, each in source order", async () => {
    // A drawn circuit with netlist errors returns every netlist finding, and
    // the generated-name notes came first: a client printing the first few
    // saw only those (#1263).
    const finding = (
      code: string,
      severity: SimulationSourceDiagnostic["severity"],
    ): SimulationSourceDiagnostic => ({ code, severity, message: code });
    const refused = await sourceCompilationProblem(
      [
        finding("GENERATED_NET_NAME", "info"),
        finding("MOS_BODY_OTHER_SUPPLY", "warning"),
        finding("MISSING_PIN_NET", "error"),
        finding("GROUND_PIN_RENAMED", "info"),
        finding("MISSING_MODEL_TARGET", "error"),
      ],
      createSimulationFolder({
        id: "refused",
        name: "Refused",
        profileId: "ngspice",
        engine: "ngspice",
      }),
    );
    expect(refused.error.code).toBe("SIMULATION_COMPILE_REFUSED");
    expect(refused.error.diagnostics?.map((item) => item.code)).toEqual([
      "MISSING_PIN_NET",
      "MISSING_MODEL_TARGET",
      "MOS_BODY_OTHER_SUPPLY",
      "GENERATED_NET_NAME",
      "GROUND_PIN_RENAMED",
    ]);
  });
});
