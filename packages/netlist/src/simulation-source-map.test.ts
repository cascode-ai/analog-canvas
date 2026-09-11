import { describe, expect, it } from "vitest";
import {
  insertSimulationText,
  locateSimulationText,
  mapSimulationFile,
  replaceSimulationText,
} from "./simulation-source-map.js";

describe("execution source maps", () => {
  it("preserves original offsets across shorter/longer run-point replacements and later preambles", () => {
    const text = "* 🧪\r\n.param R=1k C=2p\r\n.temp 27\r\nR1 a 0 {R}\r\n";
    let file = mapSimulationFile("run.cir", text);
    for (const [before, after] of [
      ["27", "-40"],
      ["2p", "1.5e-12"],
      ["1k", "2"],
    ]) {
      const start = text.indexOf(before!);
      file = replaceSimulationText(
        file,
        start,
        start + before!.length,
        after!,
        {
          kind: "generated",
          purpose: "run-variant",
          nominal: {
            path: file.path,
            startOffset: start,
            endOffset: start + before!.length,
          },
        },
      );
    }
    file = insertSimulationText(file, 0, "* injected\n", {
      kind: "generated",
      purpose: "environment",
    });
    expect(file.text).toContain(".param R=2 C=1.5e-12\r\n.temp -40");
    expect(locateSimulationText(file, file.text.indexOf("R1"))).toEqual({
      kind: "authored",
      path: "run.cir",
      startOffset: text.indexOf("R1"),
    });
    for (const segment of file.segments)
      if (segment.origin.kind === "authored")
        expect(file.text.slice(segment.startOffset, segment.endOffset)).toBe(
          text.slice(
            segment.origin.startOffset,
            segment.origin.startOffset +
              segment.endOffset -
              segment.startOffset,
          ),
        );
  });
  it("keeps exact UTF-16 author locations through multiple generated insertions", () => {
    const text = "* 温度 🌡\r\nR1 in 0 1k\r\n.end\r\n";
    const start = text.indexOf("R1");
    const initial = mapSimulationFile("run.cir", text);
    const acquisition = insertSimulationText(
      initial,
      start,
      ".save all v(in)\n",
      { kind: "generated", purpose: "canvas-acquisitions" },
    );
    const composed = insertSimulationText(
      acquisition,
      start,
      ".lib models.lib tt\n",
      { kind: "generated", purpose: "environment" },
    );
    expect(initial.text).toBe(text);
    expect(locateSimulationText(composed, composed.text.indexOf("R1"))).toEqual(
      { kind: "authored", path: "run.cir", startOffset: start },
    );
    expect(
      locateSimulationText(composed, composed.text.indexOf(".save")),
    ).toEqual({ kind: "generated", purpose: "canvas-acquisitions" });
    expect(
      locateSimulationText(composed, composed.text.indexOf(".lib")),
    ).toEqual({ kind: "generated", purpose: "environment" });
    for (const segment of composed.segments) {
      if (segment.origin.kind !== "authored") continue;
      expect(composed.text.slice(segment.startOffset, segment.endOffset)).toBe(
        text.slice(
          segment.origin.startOffset,
          segment.origin.startOffset + segment.endOffset - segment.startOffset,
        ),
      );
    }
    expect(composed.segments[0]!.startOffset).toBe(0);
    for (let index = 1; index < composed.segments.length; index++)
      expect(composed.segments[index]!.startOffset).toBe(
        composed.segments[index - 1]!.endOffset,
      );
    expect(composed.segments.at(-1)!.endOffset).toBe(composed.text.length);
  });
  it("marks generated circuit ownership, including empty files and EOF insertion", () => {
    const file = mapSimulationFile("circuit.spice", ".end", {
      kind: "generated",
      purpose: "canvas-circuit",
      bindingId: "dut",
    });
    expect(locateSimulationText(file, 0)).toMatchObject({ bindingId: "dut" });
    const empty = insertSimulationText(mapSimulationFile("empty", ""), 0, "x", {
      kind: "generated",
      purpose: "environment",
    });
    expect(empty.text).toBe("x");
    expect(locateSimulationText(empty, 0)).toMatchObject({ kind: "generated" });
  });
});
