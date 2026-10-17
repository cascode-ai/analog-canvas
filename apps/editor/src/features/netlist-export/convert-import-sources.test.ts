import { describe, expect, it } from "vitest";
import { createDesignNetlistExport } from "@icm/netlist";
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
  it("reads a Spectre name's escapes as the characters they stand for, and the export writes them back", async () => {
    const text = String.raw`simulator lang=spectre
subckt top (in\+ in\- out\<3\> bus\[2\] a\.b x\/y p\:q gnd)
R1 (in\+ out\<3\>) resistor r=1k
R2 (in\- bus\[2\]) resistor r=2k
R3 (a\.b x\/y) resistor r=3k
R4 (p\:q gnd) resistor r=4k
ends top`;
    const result = await importSpiceSources(
      convertImportSources([file("circuit.scs", text)]),
      "circuit.scs",
    );
    expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
    const project = result.project!;
    // The Cell's ports are named for the characters, not for the escapes.
    expect(
      project.documents[0]!.netlist?.terminals.map((port) => port.name),
    ).toEqual(["in+", "in-", "out<3>", "bus[2]", "a.b", "x/y", "p:q", "gnd"]);
    // SCS writes the escapes back, as it wrote them.
    const out = createDesignNetlistExport(project, { format: "spectre" });
    expect(out.status).toBe("ready");
    if (out.status !== "ready") return;
    expect(out.file.text).toContain(
      String.raw`subckt top (in\+ in\- out\<3\> bus\[2\] a\.b x\/y p\:q gnd)`,
    );
    // SPICE has no escapes: the same names, plain.
    const spice = createDesignNetlistExport(project, { format: "spice" });
    expect(spice.status === "ready" && spice.file.text).not.toContain("\\");
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
