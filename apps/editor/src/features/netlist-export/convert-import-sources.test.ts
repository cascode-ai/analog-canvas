import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import { importSpiceSources } from "@icm/spice";
import { prepareImportSources } from "./convert-import-sources.js";
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
    const converted = prepareImportSources(inputs).inputs;
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
    expect(prepareImportSources([spice]).inputs[0]).toBe(spice);
    expect(() =>
      prepareImportSources([
        file("circuit.scs", "// heading\nR1 (a 0) resistor r=1k tc1=1"),
      ]),
    ).toThrow("circuit.scs:2: Unsupported parameters: tc1");
  });
  it.each(["spice", "spectre"] as const)(
    "brings the blocks of a %s export back as the blocks that wrote them",
    async (format) => {
      const project = parseProject(
        readFileSync(
          resolve(
            import.meta.dirname,
            "../../examples/two-stage-op-amp.icproj.json",
          ),
          "utf8",
        ),
      );
      const exported = createDesignNetlistExport(project, { format });
      if (exported.status !== "ready") throw new Error("export blocked");
      const path = format === "spice" ? "circuit.sp" : "circuit.scs";
      const prepared = prepareImportSources([file(path, exported.file.text)]);
      expect(prepared.builtInBodies.map((body) => body.name)).toEqual([
        "opamp",
        "voltage_amplifier",
      ]);
      const result = await importSpiceSources(
        prepared.inputs,
        path,
        {},
        {
          builtInBodies: prepared.builtInBodies,
        },
      );
      expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
      expect(
        result.project?.documents.flatMap((document) =>
          document.instances.map((instance) => instance.symbolId),
        ),
      ).toEqual(expect.arrayContaining(["opamp", "voltage-amplifier"]));
      const again = createDesignNetlistExport(result.project!, { format });
      // Conversion from Spectre spells a value as its number (1p as 1e-12).
      const values = (text: string) => text.replace(/\bc=1e-12\b/gu, "c=1p");
      expect(again.status === "ready" && values(again.file.text)).toBe(
        exported.file.text,
      );
    },
  );
});
