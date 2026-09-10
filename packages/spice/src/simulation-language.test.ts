import { describe, expect, it } from "vitest";
import {
  inspectSimulationSource,
  lookupSimulationHelp,
  resolveSimulationInclude,
  simulationAnalysisTemplate,
} from "./simulation-language.js";

function inspect(text: string, entry = false) {
  return inspectSimulationSource(
    { id: "file", path: "run.cir", hash: "", encoding: "utf-8", text },
    entry,
  );
}

describe("simulation source assistance", () => {
  it("does not discard the first element in an included fragment", () => {
    const text = "R1 in out 1k\nC1 out 0 1n\n";
    expect(inspect(text).statements[0]!.kind).toBe("instance");
    expect(inspect(text, true).statements[0]!.kind).toBe("directive");
  });

  it("validates known signatures in their distinct command contexts", () => {
    const result = inspect(".ac dec 10\n.control\ntran 1n\nac $sweep\n.endc\n");
    expect(
      result.diagnostics.filter((d) => d.severity === "error"),
    ).toHaveLength(2);
    expect(result.commands.map((c) => c.name)).toEqual([".ac", "tran", "ac"]);
    expect(lookupSimulationHelp("AC", "control")?.signature).toMatch(/^ac /u);
    expect(lookupSimulationHelp("ac", "deck")).toBeUndefined();
    expect(lookupSimulationHelp(".param", "control")).toBeUndefined();
  });

  it("preserves unknown native commands and expressions instead of blocking execution", () => {
    const text =
      ".param gain={sqrt(4)}\nB1 x 0 V=sin(time)\n.control\nfuture_command x\nlet foo = v(x)*2\n.endc\n";
    expect(
      inspect(text).diagnostics.filter((d) => d.severity === "error"),
    ).toEqual([]);
    expect(
      inspect(text)
        .statements.map((s) => s.rawText)
        .join("\n"),
    ).toContain("future_command");
    expect(
      inspect(".endc\n").diagnostics.some((d) => d.severity === "error"),
    ).toBe(true);
  });

  it("resolves virtual relative paths but never host paths or root escapes", () => {
    expect(resolveSimulationInclude("tb/run.cir", '"../models/tt.spice"')).toBe(
      "models/tt.spice",
    );
    for (const path of [
      "../../outside",
      "C:/secret",
      "/etc/passwd",
      "https://host/file",
      "..\\secret",
    ])
      expect(resolveSimulationInclude("tb/run.cir", path)).toBeNull();
  });

  it("templates remain editable native source and explicitly collect each analysis", () => {
    for (const kind of ["op", "ac", "dc", "tran", "noise"] as const) {
      const text = simulationAnalysisTemplate(kind);
      expect(text).toContain("write out.raw");
      expect(inspect(`.control\n${text}.endc\n`).diagnostics).toEqual([]);
    }
  });
});
