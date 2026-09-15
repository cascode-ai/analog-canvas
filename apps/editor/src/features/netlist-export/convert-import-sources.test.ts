import { describe, expect, it } from "vitest";
import { importSpiceSources } from "@icm/spice";
import { convertImportSources } from "./convert-import-sources.js";
const file = (path: string, text: string) => ({
  path,
  bytes: new TextEncoder().encode(text),
});
describe("Spectre import conversion", () => {
  it("converts the entry and local includes while retaining their paths", async () => {
    const inputs = [
      file(
        "circuit.scs",
        'simulator lang=spectre\ninclude "leaf.inc"\nsubckt Main (z a)\nX1 (z a) leaf\nends Main',
      ),
      file(
        "leaf.inc",
        "subckt leaf (out in)\nR1 (out in) resistor r=1k\nends leaf",
      ),
    ];
    const before = structuredClone(inputs);
    const converted = convertImportSources(inputs);
    expect(inputs).toEqual(before);
    expect(converted.map((f) => f.path)).toEqual(["circuit.scs", "leaf.inc"]);
    const result = await importSpiceSources(converted, "circuit.scs");
    expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
    expect(result.project?.documents.map((d) => d.netlist?.name)).toEqual(
      expect.arrayContaining(["Main", "leaf"]),
    );
  });
  it("leaves ordinary SPICE unchanged and rejects lossy SCS with a file/line", () => {
    const spice = file("circuit.spi", "R1 a 0 1k");
    expect(convertImportSources([spice])[0]).toBe(spice);
    expect(() =>
      convertImportSources([
        file("circuit.scs", "// heading\nR1 (a 0) resistor r=1k tc1=1"),
      ]),
    ).toThrow("circuit.scs:2: Unsupported parameters: tc1");
  });
});
