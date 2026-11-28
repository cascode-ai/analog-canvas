import { describe, expect, it } from "vitest";
import { CircuitProjectSchema, createSimulationFolder } from "@icm/model";
import { currentFiveTransistorOtaCircuitSource } from "../../../apps/editor/src/examples/five-transistor-ota.test-support.js";
import { CapabilitiesSchema } from "./contract.js";
import { prepareSourceExecutionInput } from "./prepare-source.js";

const project = () =>
  CircuitProjectSchema.parse(currentFiveTransistorOtaCircuitSource());

const caps = CapabilitiesSchema.parse({
  configured: true,
  rawfileCollection: "declared-single-ascii",
  maxInputFiles: 24,
  inputs: ["source", "raw"],
  analyses: ["op", "dc", "ac", "tran", "noise"],
  parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
  profiles: [
    {
      id: "sky130-test",
      engine: "ngspice",
      corners: ["tt", "ff", "ss"],
      dependencies: [{ id: "models", sha256: "a".repeat(64) }],
    },
  ],
  modelLibrary: { path: "models/sky130.lib.spice", section: "tt" },
  maxInputBytes: 2 * 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxTimeoutMs: 120000,
  cancel: true,
});

describe("source execution preparation", () => {
  it("delegates valid ngspice source folders and keeps authored input immutable", async () => {
    const circuit = project();
    const folder = createSimulationFolder({
      id: "ng",
      name: "NG",
      profileId: "sky130-test",
      documentId: circuit.topDocumentId,
    });
    const before = structuredClone({ circuit, folder });
    const prepared = await prepareSourceExecutionInput(circuit, folder, caps);
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.input.mode).toBe("raw");
    expect(prepared.input.entryPath).toBe("run.cir");
    expect(prepared.input.environment.profileId).toBe("sky130-test");
    expect({ circuit, folder }).toEqual(before);
  });

  it("refuses unknown Profiles and invalid experiment configurations before preparation", async () => {
    const circuit = project();
    const unknown = createSimulationFolder({
      id: "missing",
      name: "Missing",
      profileId: "absent",
    });
    expect(
      await prepareSourceExecutionInput(circuit, unknown, caps),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_PROFILE_UNKNOWN" },
    });

    const invalid = createSimulationFolder({
      id: "invalid",
      name: "Invalid",
      profileId: "sky130-test",
    });
    invalid.input.files.find(
      (file) => file.path === invalid.input.configPath,
    )!.text = "{";
    expect(
      await prepareSourceExecutionInput(circuit, invalid, caps),
    ).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_COMPILE_REFUSED",
        diagnostics: [
          expect.objectContaining({ code: "SIMULATION_CONFIG_INVALID" }),
        ],
      },
    });
  });
});
