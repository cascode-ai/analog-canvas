import { describe, expect, it } from "vitest";
import { createSimulationFolder } from "./simulation-source-authoring";

describe("experiment starter instructions", () => {
  it.each(["canvas", "mixed", "text"] as const)(
    "guides %s authoring without imposing a DUT",
    (kind) => {
      const folder = createSimulationFolder({
        id: "test",
        name: "Test",
        profileId: "test",
        ...(kind !== "text" ? { documentId: "dut" } : {}),
        ...(kind === "mixed"
          ? { dut: { name: "amp", ports: ["in", "out", "vss"] } }
          : {}),
      });
      const text = folder.input.files.find(
        (file) => file.path === "run.cir",
      )!.text;
      expect(text).toContain("// 2. Click Run.");
      expect(text).toContain("// 3. Open Operating Point");
      expect(text).toContain('options rawfile="ascii" strictsave=2');
      expect(text).toContain("analysis op op");
      expect(text).not.toMatch(/\.control|\.endc|write out\.raw|appendwrite/u);
      expect(text).toContain(
        kind === "canvas"
          ? "Check Canvas sources"
          : kind === "mixed"
            ? "Complete sources, loads"
            : "Add your circuit",
      );
      if (kind === "text") expect(text).not.toContain(".include");
      if (kind === "mixed")
        expect(folder.input.files[0]!.text).toContain(
          "// DUT port order: 'in' 'out' 'vss'",
        );
    },
  );
  it("starts an author's Testbench with no Profile, configuration or run steps", () => {
    const folder = createSimulationFolder({
      id: "tb",
      name: "OTA gain",
      template: "testbench",
      documentId: "ota",
      dut: { name: "ota5t", ports: ["inp", "inn", "out", "vdd", "0"] },
    });
    expect(folder.input.entry).toBe("testbench.spice");
    expect(folder.input.files.map((file) => file.path)).toEqual([
      "testbench.spice",
    ]);
    const text = folder.input.files[0]!.text;
    expect(text).toContain('.include "circuit.spice"');
    expect(text).toContain("XDUT inp inn out vdd 0 ota5t");
    // The example names the syntax without declaring a Spec itself.
    expect(text).toContain("@spec gain >= 60 unit=dB");
    expect(text).not.toMatch(/^\s*\*\s*@spec/mu);
    expect(text).not.toMatch(/Click Run|\.control|write out\.raw/u);
    expect(folder.input.circuitBindings).toEqual([
      expect.objectContaining({ documentId: "ota", emission: "subcircuit" }),
    ]);
    const portless = createSimulationFolder({
      id: "tb2",
      name: "Self-driven",
      template: "testbench",
      documentId: "bench",
      dut: { name: "bench", ports: [] },
    });
    expect(portless.input.circuitBindings[0]!.emission).toBe("top-level");
    expect(portless.input.files[0]!.text).not.toContain("XDUT");
  });

  it("writes no configuration and uses SPICE syntax when no Profile is named", () => {
    const folder = createSimulationFolder({
      id: "free",
      name: "Free",
      documentId: "dut",
    });
    expect(
      folder.input.files.some((file) => file.path === folder.input.configPath),
    ).toBe(false);
    expect(
      folder.input.files.find((file) => file.path === "run.cir")!.text,
    ).toContain(".control");
  });

  it("quotes DUT interface names without changing pin order, case or punctuation", () => {
    const folder = createSimulationFolder({
      id: "quoted",
      name: "One\nTitle",
      profileId: "candidate",
      documentId: "dut",
      dut: { name: "AMP.block", ports: ["In+", "In-", "O'ut", "0"] },
    });
    expect(folder.input.files[0]!.text).toContain(
      "XDUT ('In+' 'In-' 'O''ut' '0') 'AMP.block'",
    );
    expect(
      folder.input.files
        .find((f) => f.path === folder.input.entry)!
        .text.split("\n")[0],
    ).toBe("One Title");
    expect(() =>
      createSimulationFolder({
        id: "bad",
        name: "Bad",
        profileId: "candidate",
        dut: { name: "DUT", ports: ["In\ncontrol"] },
      }),
    ).toThrow(/identifier/u);
  });
});
