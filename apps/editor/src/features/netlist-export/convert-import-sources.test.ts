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
  it.each(["unreferenced file", "inactive branch"])(
    "keeps an author's Cell when an %s defines a built-in of the same name",
    async (location) => {
      const example = parseProject(
        readFileSync(
          resolve(
            import.meta.dirname,
            "../../examples/two-stage-op-amp.icproj.json",
          ),
          "utf8",
        ),
      );
      const exported = createDesignNetlistExport(example, { format: "spice" });
      if (exported.status !== "ready") throw new Error("export blocked");
      const entry = [
        ".subckt opamp VDD VSS VIP VIN VOUT",
        "R1 VIP VOUT 10k",
        "R2 VIN VSS 100k",
        ".ends opamp",
        ".subckt main vdd vss vip vin vout",
        "X1 vdd vss vip vin vout opamp",
        ".ends main",
      ].join("\n");
      const prepared = prepareImportSources(
        location === "unreferenced file"
          ? [file("entry.sp", entry), file("unused.sp", exported.file.text)]
          : [
              file(
                "entry.sp",
                `${entry}\n.if 0\n${exported.file.text}\n.endif\n`,
              ),
            ],
      );
      const result = await importSpiceSources(
        prepared.inputs,
        "entry.sp",
        {},
        {
          builtInBodies: prepared.builtInBodies,
        },
      );
      expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
      const custom = result.project?.documents.find(
        (cell) => cell.netlist?.name === "opamp",
      );
      expect(
        custom?.instances
          .filter((part) => part.symbolId === "resistor")
          .map((part) => part.reference),
      ).toEqual(["R1", "R2"]);
      const call = result.project?.documents
        .find((cell) => cell.netlist?.name === "main")
        ?.instances.find((part) => part.reference === "X1");
      expect(call?.netlist?.binding).toEqual({
        kind: "subcircuit",
        childDocumentId: custom?.id,
      });
    },
  );
  it("keeps model bindings when a different Cell defines a same-name ideal switch", async () => {
    const prepared = prepareImportSources([
      file(
        "switches.sp",
        [
          ".subckt custom a b c",
          ".model ideal_switch SW(RON=2 ROFF=1e12 VT=0.5 VH=0)",
          "S1 a b c 0 ideal_switch",
          ".ends custom",
          ".subckt standard a b c",
          ".model ideal_switch SW(RON=1 ROFF=1e12 VT=0.5 VH=0)",
          "S2 a b c 0 ideal_switch",
          ".ends standard",
        ].join("\n"),
      ),
    ]);
    const result = await importSpiceSources(
      prepared.inputs,
      "switches.sp",
      {},
      {
        builtInBodies: prepared.builtInBodies,
      },
    );
    expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
    for (const cell of result.project!.documents) {
      const part = cell.instances.find((instance) =>
        instance.reference?.startsWith("S"),
      );
      expect(part?.symbolId).toBe("voltage-controlled-switch");
      expect(part?.netlist?.binding).toEqual({
        kind: "model",
        deviceClass: "switch",
        name: "ideal_switch",
      });
    }
  });
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
  it("reads a Spectre name's escapes as the characters they stand for, and the export writes them back", async () => {
    const text = String.raw`simulator lang=spectre
subckt top (in\+ in\- out\<3\> bus\[2\] a\.b x\/y p\:q gnd)
R1 (in\+ out\<3\>) resistor r=1k
R2 (in\- bus\[2\]) resistor r=2k
R3 (a\.b x\/y) resistor r=3k
R4 (p\:q gnd) resistor r=4k
ends top`;
    const result = await importSpiceSources(
      prepareImportSources([file("circuit.scs", text)]).inputs,
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
