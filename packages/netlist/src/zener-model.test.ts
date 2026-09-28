import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";

import { createDesignNetlistExport } from "./export.js";

function zenerProject(parameters: Record<string, string>, model?: string) {
  const project = createEmptyProject("zener", "Zener", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  document.instances.push({
    id: "zener",
    symbolId: "zener-diode",
    reference: "D1",
    placement: null,
    netlist: {
      ...(model
        ? {
            binding: {
              kind: "model" as const,
              deviceClass: "diode" as const,
              name: model,
            },
          }
        : {}),
      parameters,
    },
  });
  for (const [pinName, name] of [
    ["A", "anode"],
    ["K", "cathode"],
  ] as const) {
    document.nets.push({
      id: name,
      terminals: [{ instanceId: "zener", pinName }],
    });
    document.connectivityEvidence.push({
      id: `${name}-name`,
      kind: "net-name-hint",
      netId: name,
      sourceName: name,
      origin: "spice-import",
    });
  }
  return project;
}

describe("Zener built-in diode model", () => {
  it("emits a per-cell D model from explicit BV and optional IBV", () => {
    const result = createDesignNetlistExport(
      zenerProject({ bv: "5.1", ibv: "1m" }),
    );
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain(".model icm_zener_D1 D(BV=5.1 IBV=1m)");
    expect(result.file.text).toContain("D1 anode cathode icm_zener_D1");
    expect(result.file.text).not.toContain("D1 anode cathode icm_zener_D1 bv=");
    const spectre = createDesignNetlistExport(zenerProject({ bv: "5.1" }), {
      format: "spectre",
    });
    expect(spectre.status).toBe("blocked");
    expect(spectre.diagnostics.map((item) => item.code)).toContain(
      "ZENER_BUILTIN_SPICE_ONLY",
    );
  });

  it("preserves explicit model binding and refuses conflicting local parameters", () => {
    const external = createDesignNetlistExport(
      zenerProject({}, "vendor_zener"),
    );
    expect(external.status).toBe("ready");
    if (external.status === "ready") {
      expect(external.file.text).toContain("D1 anode cathode vendor_zener");
      expect(external.file.text).not.toContain(".model icm_zener_D1");
    }
    const conflict = createDesignNetlistExport(
      zenerProject({ bv: "5.1" }, "vendor_zener"),
    );
    expect(conflict.status).toBe("blocked");
    expect(conflict.diagnostics.map((item) => item.code)).toContain(
      "ZENER_MODEL_PARAMETER_CONFLICT",
    );
  });

  it("requires a positive explicit BV without an external model", () => {
    const missing = createDesignNetlistExport(zenerProject({}));
    expect(missing.status).toBe("blocked");
    expect(missing.diagnostics.map((item) => item.code)).toContain(
      "MISSING_MODEL_TARGET",
    );
    for (const value of ["0", "-3", "not-a-number"]) {
      const invalid = createDesignNetlistExport(zenerProject({ bv: value }));
      expect(invalid.status).toBe("blocked");
      expect(invalid.diagnostics.map((item) => item.code)).toContain(
        "INVALID_ZENER_MODEL_PARAMETER",
      );
    }
  });
});
