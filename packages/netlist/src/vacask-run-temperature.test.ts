import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  createSimulationFolder,
  type SimulationRunVariant,
} from "@icm/model";
import { compileSourceSimulation } from "./simulation-source-compile.js";
import { locateSimulationText } from "./simulation-source-map.js";

function fixture(control: string) {
  const project = createEmptyProject("p", "Native temperature");
  const folder = createSimulationFolder({
    id: "s",
    name: "Native",
    profileId: "local",
  });
  const entry = folder.input.files.find((f) => f.path === folder.input.entry)!;
  entry.text = `Temperature test\nparameters BIAS=1\n${control}\n`;
  return { project, folder, entry };
}
const temperature = (temperatureC: number): SimulationRunVariant => ({
  environment: { temperatureC },
});

describe("native ambient run-point projection", () => {
  it("sets temperature before each complete sweep/analysis group, preserving tnom, options and indentation", () => {
    const f = fixture(`control
options temp=27 tnom=25
  sweep bias instance="V1" parameter="dc" from=0 to=1 step=1 // first
  sweep tolerance option="reltol" from=1e-4 to=1e-3 step=1e-4
    analysis dc op
clear options
analysis frequency ac from=1 to=10 mode="lin" points=2
endc`);
    const before = structuredClone(f);
    const result = compileSourceSimulation(f.project, f.folder, temperature(0));
    if (!result.ok) throw Error(JSON.stringify(result));
    const text = result.files.find((file) => file.path === f.entry.path)!.text;
    expect(text.match(/options temp=0/g)).toHaveLength(2);
    expect(text).toContain(
      "options temp=27 tnom=25\n  options temp=0\n  sweep bias",
    );
    expect(text).toContain(
      '  sweep tolerance option="reltol" from=1e-4 to=1e-3 step=1e-4\n    analysis dc op',
    );
    expect(text).toContain("clear options\noptions temp=0\nanalysis frequency");
    expect(result.config.environment).toEqual({ profileId: "local" });
    expect(f).toEqual(before);
  });

  it("composes variable and temperature edits while retaining nominal source positions", () => {
    const f = fixture("control\n  analysis proof op\nendc");
    const result = compileSourceSimulation(f.project, f.folder, {
      ...temperature(125),
      variables: [{ variableId: "BIAS", value: "1.23456789" }],
    });
    if (!result.ok) throw Error(JSON.stringify(result));
    const file = result.files.find((file) => file.path === f.entry.path)!;
    const map = result.sourceMaps.find((map) => map.path === file.path)!;
    expect(
      locateSimulationText(map, file.text.indexOf("analysis proof")),
    ).toEqual({
      kind: "authored",
      path: file.path,
      startOffset: f.entry.text.indexOf("analysis proof"),
    });
    expect(
      locateSimulationText(map, file.text.indexOf("options temp=125")),
    ).toEqual({
      kind: "generated",
      purpose: "run-variant",
      nominal: {
        path: file.path,
        startOffset: f.entry.text.indexOf("analysis proof"),
        endOffset: f.entry.text.indexOf("analysis proof"),
      },
    });
  });

  it.each(['"temp"', "targetOption"])(
    "does not mislabel a native option sweep %s as a fixed temperature run",
    (option) => {
      const f = fixture(
        `control\nvar targetOption="temp"\nsweep t option=${option} from=0 to=100 step=10\nanalysis thermal op\nendc`,
      );
      const before = structuredClone(f);
      expect(compileSourceSimulation(f.project, f.folder).ok).toBe(true);
      const result = compileSourceSimulation(f.project, f.folder, {
        ...temperature(125),
        variables: [{ variableId: "BIAS", value: "1.23456789" }],
      });
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [
          {
            code: "SIMULATION_TEMPERATURE_SWEEP_CONFLICT",
            sourceRef: { start: { offset: f.entry.text.indexOf("sweep t") } },
          },
        ],
      });
      expect(f).toEqual(before);
    },
  );

  it("retains native loop structure and applies the point where each analysis executes", () => {
    const f = fixture(
      "control\nmc samples samples=2\n  analysis sample op\nendmc\nendc",
    );
    const result = compileSourceSimulation(
      f.project,
      f.folder,
      temperature(-40),
    );
    if (!result.ok) throw Error(JSON.stringify(result));
    expect(
      result.files.find((file) => file.path === f.entry.path)!.text,
    ).toContain(
      "mc samples samples=2\n  options temp=-40\n  analysis sample op\nendmc",
    );
  });

  it("keeps code-only programs editable but does not claim a temperature for unlocated analyses", () => {
    const f = fixture('control\nprint "analysis not_a_command op"\nendc');
    expect(compileSourceSimulation(f.project, f.folder).ok).toBe(true);
    expect(
      compileSourceSimulation(f.project, f.folder, temperature(27)),
    ).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "SIMULATION_TEMPERATURE_ANALYSIS_UNAVAILABLE",
          message: expect.any(String),
          severity: "error",
        },
      ],
    });
  });
});
