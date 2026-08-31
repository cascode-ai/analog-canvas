import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { compileSourceBundle, compileSpiceSources } from "./compiler.js";
import { importCompileResult } from "./importer.js";
import { loadSourceBundleFromFile } from "./node-source.js";

describe("SPICE elaboration and Project import", () => {
  it("imports capacitor source positions onto stable plate pins", async () => {
    const imported = importCompileResult(
      await compileSpiceSources(
        [
          {
            path: "capacitor.spi",
            bytes: Buffer.from("Capacitor test\nC1 TOP BOT 2p\n.end\n"),
          },
        ],
        "capacitor.spi",
      ),
    );
    const capacitor = imported.project?.documents[0]?.instances[0];
    expect(capacitor).toMatchObject({
      symbolId: "capacitor",
      importProvenance: {
        terminalMapping: [
          { sourcePosition: 0, pinName: "1" },
          { sourcePosition: 1, pinName: "2" },
        ],
      },
    });
  });

  it("imports ordered Cell formal parameter defaults", async () => {
    const imported = importCompileResult(
      await compileSpiceSources(
        [
          {
            path: "parameterized.spi",
            bytes: Buffer.from(`
.subckt gain_cell IN OUT params: gain=10 bias={gain/2}
R1 IN OUT 1k
.ends gain_cell
`),
          },
        ],
        "parameterized.spi",
      ),
    );

    expect(imported.successful).toBe(true);
    expect(imported.project?.documents[0]?.netlist?.formalParameters).toEqual([
      { name: "gain", defaultValue: "10" },
      { name: "bias", defaultValue: "{gain/2}" },
    ]);
  });

  it("imports reviewed diode and BJT contracts", async () => {
    const source = Buffer.from(`
.model DREF D
.model QNREF NPN
.model QPREF PNP
D1 anode 0 DREF
Q1 collector base emitter QNREF
Q2 collector base emitter QPREF
.end
`);
    const imported = importCompileResult(
      await compileSpiceSources(
        [{ path: "common.cir", bytes: source }],
        "common.cir",
      ),
    );
    expect(imported.successful).toBe(true);
    expect(imported.project?.documents[0]?.netlist).toMatchObject({
      name: "__flat__",
      terminals: [],
    });
    expect(imported.project?.documents[0]?.connectivityEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "net-name-hint",
          origin: "spice-import",
        }),
        expect.objectContaining({
          kind: "name-claim",
          owner: {
            kind: "global-declaration",
            sourceNetId: expect.any(String),
          },
        }),
        expect.objectContaining({ kind: "spice-source" }),
      ]),
    );
    expect(
      imported.project?.documents[0]?.instances.map((instance) => [
        instance.netlist?.reference,
        instance.symbolId,
        instance.importProvenance,
      ]),
    ).toEqual([
      [
        "D1",
        "diode",
        expect.objectContaining({
          kind: "model",
          name: "DREF",
          status: "resolved",
          modelType: "d",
        }),
      ],
      [
        "Q1",
        "npn",
        expect.objectContaining({
          kind: "model",
          name: "QNREF",
          status: "resolved",
          modelType: "npn",
        }),
      ],
      [
        "Q2",
        "pnp",
        expect.objectContaining({
          kind: "model",
          name: "QPREF",
          status: "resolved",
          modelType: "pnp",
        }),
      ],
    ]);
  });

  it("keeps SPICE G syntax in IR but rejects it without a reviewed product symbol", async () => {
    const compiled = await compileSpiceSources(
      [
        {
          path: "vccs.cir",
          bytes: Buffer.from("VCCS syntax test\nG1 out 0 ctrl 0 1m\n.end\n"),
        },
      ],
      "vccs.cir",
    );
    expect(compiled.successful).toBe(true);
    const vccs = compiled.ir?.cells
      .flatMap((cell) => cell.instances)
      .find(
        (instance) =>
          instance.target.kind === "primitive" &&
          instance.target.family === "vccs",
      );
    expect(vccs?.target).toEqual({
      kind: "primitive",
      family: "vccs",
    });
    const imported = importCompileResult(compiled);
    expect(imported.successful).toBe(false);
    expect(imported.project).toBeNull();
    expect(imported.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SPICE_IMPORT_UNSUPPORTED_SYMBOL",
          message: expect.stringContaining("primitive:vccs"),
        }),
      ]),
    );
  });

  it("preserves mixed-device IR but rejects devices outside the Razavi catalog", async () => {
    const entry = resolve(
      process.cwd(),
      "netlists/mixed-device-acceptance/circuit.spi",
    );
    const compiled = compileSourceBundle(await loadSourceBundleFromFile(entry));
    expect(compiled.successful).toBe(true);
    expect(compiled.ir).not.toBeNull();
    const ir = compiled.ir!;
    expect(ir.topCells).toEqual(["mixed_device_acceptance"]);
    expect(ir.cells).toHaveLength(8);
    expect(ir.parameters.map((item) => [item.name, item.rawText])).toEqual([
      ["RBASE", "4.7k"],
      ["CCOMP", "2p"],
      ["LISO", "8n"],
    ]);
    expect(ir.models.map((item) => [item.name, item.modelType])).toEqual([
      ["DACC", "D"],
      ["QNACC", "NPN"],
      ["QPACC", "PNP"],
      ["SWACC", "SW"],
    ]);
    const top = ir.cells.find(
      (cell) => cell.name === "mixed_device_acceptance",
    )!;
    expect(top.instances).toHaveLength(7);
    expect(top.instances[0]!.target).toEqual({
      kind: "subcircuit",
      cellName: "mixed_passive_cell",
    });
    expect(
      top.instances[0]!.terminals.map((terminal) => terminal.name),
    ).toEqual(["IN", "OUT", "VSS"]);

    const imported = importCompileResult(compiled);
    expect(imported.successful).toBe(false);
    expect(imported.project).toBeNull();
    const unsupported = imported.diagnostics.filter(
      (item) => item.code === "SPICE_IMPORT_UNSUPPORTED_SYMBOL",
    );
    expect(unsupported.length).toBeGreaterThan(0);
    expect(unsupported.every((item) => item.severity === "error")).toBe(true);
    expect(unsupported.some((item) => item.message.includes("Razavi"))).toBe(
      true,
    );
  });

  it("imports reviewed inductors with the scale-reconciled Razavi symbol", async () => {
    const entry = resolve(
      process.cwd(),
      "netlists/rlc-broadband-50-to-200-match/circuit.spi",
    );
    const imported = importCompileResult(
      compileSourceBundle(await loadSourceBundleFromFile(entry)),
    );
    expect(imported.project).not.toBeNull();
    expect(imported.successful).toBe(true);
    expect(
      imported.project?.documents[0]?.instances
        .filter((instance) => instance.symbolId === "inductor-compact")
        .map((instance) => instance.netlist?.reference),
    ).toEqual(["L1", "L2"]);
  });

  it("preserves SKY130 X calls as external interfaces without losing source facts", async () => {
    const entry = resolve(
      process.cwd(),
      "netlists/sky130-ota-5t-gain40-pm60-noise50uv-pvt/circuit.spi",
    );
    const imported = importCompileResult(
      compileSourceBundle(await loadSourceBundleFromFile(entry)),
    );
    expect(imported.successful).toBe(true);
    expect(
      imported.diagnostics.filter(
        (diagnostic) => diagnostic.code === "SPICE_IMPORT_UNSUPPORTED_SYMBOL",
      ),
    ).toEqual([]);
    const document = imported.project!.documents[0]!;
    const cellPinInstanceIds = new Set(
      document.netlist!.terminals.flatMap(
        (terminal) => terminal.interfaceInstanceIds,
      ),
    );
    expect(
      document.instances
        .filter((instance) => cellPinInstanceIds.has(instance.id))
        .every((instance) => instance.schematicReference === undefined),
    ).toBe(true);
    expect(
      document.instances
        .filter((instance) => !cellPinInstanceIds.has(instance.id))
        .every(
          (instance) =>
            instance.netlist?.binding?.kind === "external-subcircuit",
        ),
    ).toBe(true);
    expect(
      document.instances
        .filter((instance) => !cellPinInstanceIds.has(instance.id))
        .map((instance) => instance.symbolId)
        .filter(
          (symbolId, index, symbols) => symbols.indexOf(symbolId) === index,
        )
        .sort(),
    ).toEqual(["nmos", "pmos"]);
    expect(document.instances[0]!.importProvenance).toMatchObject({
      kind: "opaque",
      name: "sky130_fd_pr__nfet_01v8",
      status: "resolved",
      sourceTarget: "external-subcircuit:sky130_fd_pr__nfet_01v8",
      symbolMappingRegistryId: "sky130-nfet-four-terminal",
      terminalMapping: [
        { sourcePosition: 0, pinName: "D" },
        { sourcePosition: 1, pinName: "G" },
        { sourcePosition: 2, pinName: "S" },
        { sourcePosition: 3, pinName: "B" },
      ],
    });
    expect(document.instances[0]!.netlist).toEqual({
      reference: "XM1",
      binding: expect.objectContaining({ kind: "external-subcircuit" }),
      parameters: { l: "1.0", w: "96", nf: "12" },
    });
    expect(document.instances[0]).toMatchObject({
      symbolId: "nmos",
    });
    const resolved = createProjectSymbolResolver(
      imported.project!,
      builtInSymbols,
    ).resolve(document.instances[0]!.symbolId);
    const nmos = builtInSymbols.find((symbol) => symbol.id === "nmos");
    expect(resolved).toMatchObject({
      definition: {
        pins: nmos?.pins,
        primitives: nmos?.primitives,
        defaultVariantId: "textbook-3terminal",
        variants: nmos?.variants,
      },
      variant: expect.objectContaining({
        id: "textbook-3terminal",
        hiddenPinNames: ["B"],
      }),
    });
    expect(
      document.nets
        .flatMap((net) => net.terminals)
        .filter((terminal) => terminal.instanceId === "XM1")
        .map((terminal) => terminal.pinName),
    ).toEqual(expect.arrayContaining(["D", "G", "S", "B"]));
  });

  it("ignores an explicit mapping to a removed compatibility symbol", async () => {
    const entry = resolve(
      process.cwd(),
      "netlists/sky130-ota-5t-gain40-pm60-noise50uv-pvt/circuit.spi",
    );
    const imported = importCompileResult(
      compileSourceBundle(await loadSourceBundleFromFile(entry)),
      {
        symbolMappings: [
          {
            modelName: "sky130_fd_pr__nfet_01v8",
            terminalCount: 4,
            symbolId: "generic-block-4",
            pinNames: ["DRAIN", "GATE", "SOURCE", "BULK"],
            registryId: "project:reviewed-nfet",
          },
        ],
      },
    );
    const document = imported.project!.documents[0]!;
    const instance = document.instances.find(
      (candidate) => candidate.netlist?.reference === "XM1",
    )!;
    expect(instance).toMatchObject({
      netlist: expect.objectContaining({
        binding: expect.objectContaining({ kind: "external-subcircuit" }),
      }),
      importProvenance: expect.objectContaining({
        symbolMappingRegistryId: "sky130-nfet-four-terminal",
        terminalMapping: [
          { sourcePosition: 0, pinName: "D" },
          { sourcePosition: 1, pinName: "G" },
          { sourcePosition: 2, pinName: "S" },
          { sourcePosition: 3, pinName: "B" },
        ],
      }),
    });
    expect(
      imported.diagnostics.filter(
        (diagnostic) => diagnostic.code === "SPICE_IMPORT_UNSUPPORTED_SYMBOL",
      ),
    ).toEqual([]);
  });

  it("imports the SKY130 thermometer resistor with generic external masters", async () => {
    const entry = resolve(
      process.cwd(),
      "netlists/sky130-thermometer-trim-resistor/circuit.spi",
    );
    const imported = importCompileResult(
      compileSourceBundle(await loadSourceBundleFromFile(entry)),
    );

    expect(imported.successful).toBe(true);
    expect(
      imported.project?.externalSubcircuitDefinitions.map((definition) => [
        definition.name,
        definition.interfaceStatus,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["sky130_fd_pr__nfet_01v8", "inferred-positional"],
        ["sky130_fd_pr__pfet_01v8", "inferred-positional"],
        ["sky130_fd_pr__res_high_po", "inferred-positional"],
      ]),
    );
    expect(
      imported.project?.documents
        .flatMap((document) => document.instances)
        .filter(
          (instance) =>
            instance.netlist?.binding?.kind === "external-subcircuit",
        )
        .every((instance) => instance.netlist?.reference?.startsWith("X")),
    ).toBe(true);
  });
});
