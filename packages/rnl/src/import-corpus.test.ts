import { CircuitProjectSchema } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { convertNetlist, importSpiceSources } from "@icm/spice";
import { startCore } from "@rich-netlist/runtime";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyRnlSnapshot,
  drawnModelTypes,
  undrawnBodies,
  type RnlSnapshot,
} from "./index.js";

const core = startCore();
afterAll(() => core.terminate());

function source(
  format: "spice" | "spectre",
  body: readonly string[],
  records: readonly string[],
) {
  const comment = format === "spice" ? "*" : "//";
  return [
    `${comment} Synthetic import regression; no user data`,
    `${comment} @RNL(type="header") { @VERSION("0.3"); @USE-PACKAGE(name="rnl-std-full", version="0.3") }`,
    ...(format === "spectre" ? ["simulator lang=spectre"] : []),
    ...body,
    `${comment} @RNL {`,
    ...records.map((record) => `${comment} ${record}`),
    `${comment} }`,
    ...(body.some((line) => /^(?:\.subckt|subckt)\s/u.test(line))
      ? [format === "spice" ? ".ends dut" : "ends dut"]
      : []),
    ...(format === "spice" ? [".end"] : []),
    "",
  ].join("\n");
}

async function read(text: string, format: "spice" | "spectre") {
  const path = format === "spice" ? "case.sp" : "case.scs";
  const snapshot = (await core.snapshot({
    entry: path,
    files: { [path]: text },
    dialect: format,
    parts: { host: true, model: true },
  })) as unknown as RnlSnapshot;
  expect(snapshot.failed).toBeNull();
  expect(
    snapshot.diagnostics.filter((item) => item.severity === "error"),
  ).toEqual([]);
  const converted =
    format === "spectre"
      ? convertNetlist({ text, source: "spectre", target: "spice" })
      : null;
  if (converted?.status === "blocked")
    throw new Error(JSON.stringify(converted.issues));
  const inputs = [
    { path, bytes: new TextEncoder().encode(converted?.text ?? text) },
  ];
  const imported = await importSpiceSources(
    inputs,
    path,
    {},
    {
      namingProfile: "native",
      modelTypes: drawnModelTypes(snapshot),
      libraryBodies: undrawnBodies(snapshot, [path]),
    },
  );
  expect(
    imported.diagnostics.filter((item) => item.severity === "error"),
  ).toEqual([]);
  if (!imported.project || !imported.successful)
    throw new Error("Expected supported synthetic input");
  const before = structuredClone(imported.project);
  const drawn = applyRnlSnapshot(imported.project, snapshot);
  expect(imported.project).toEqual(before);
  expect(drawn.diagnostics).toEqual([]);
  expect(() => CircuitProjectSchema.parse(drawn.project)).not.toThrow();
  return { ...drawn, snapshot };
}

describe("hand-authored RNL import corpus", () => {
  it.each(["spice", "spectre"] as const)(
    "restores variable R/C and NPN artwork from %s without an exporter oracle (#1786)",
    async (format) => {
      const result = await read(
        source(
          format,
          format === "spice"
            ? [
                ".model NPN NPN",
                ".subckt dut IN OUT",
                "R1 IN OUT 1k",
                "C1 OUT 0 2p",
                "Q1 OUT IN 0 NPN",
              ]
            : [
                "model NPN bjt type=npn",
                "subckt dut (IN OUT)",
                "R1 (IN OUT) resistor r=1k",
                "C1 (OUT 0) capacitor c=2p",
                "Q1 (OUT IN 0) NPN",
              ],
          [
            '#R1 @SET-SYMBOL $VARIABLE_RESISTOR => @PLACE(0, 0) => @ORIENT("R0");',
            '#C1 @SET-SYMBOL $VARIABLE_CAPACITOR => @PLACE(8, 0) => @ORIENT("R0");',
            '#Q1 @SET-SYMBOL $NPN => @PLACE(16, 0) => @ORIENT("R0");',
            '&0 @WIRE(mode="straight") {#C1:2 #Q1:3}',
          ],
        ),
        format,
      );
      const parts = result.project.documents
        .flatMap((document) => document.instances)
        .filter((instance) => instance.reference);
      expect(
        parts.map((instance) => [instance.reference, instance.symbolId]),
      ).toEqual([
        ["R1", "variable-resistor"],
        ["C1", "variable-capacitor"],
        ["Q1", "npn"],
      ]);
      expect(parts.map((instance) => instance.placement?.position)).toEqual([
        { x: 0, y: 0 },
        { x: 80, y: 0 },
        { x: 160, y: 0 },
      ]);
    },
  );

  it.each(["spice", "spectre"] as const)(
    "defines the used default diode model in the %s design netlist (#1789)",
    async (format) => {
      const result = await read(
        source(
          format,
          format === "spice"
            ? [".model DIODE D(IS=1e-14 N=1)", "D1 a 0 DIODE"]
            : ["model DIODE diode is=1e-14 n=1", "D1 (a 0) DIODE"],
          [
            '#D1 @SET-SYMBOL $DIODE => @PLACE(0, 0) => @ORIENT("R0");',
            "%g = $GROUND @ATTACH &0 => @PLACE(4, -2);",
            '&0 @WIRE(mode="straight") {#D1:2 %g:p}',
          ],
        ),
        format,
      );
      const written = createDesignNetlistExport(result.project, {
        format: "spice",
        uncalledCells: true,
      });
      expect(written.status).toBe("ready");
      if (written.status !== "ready")
        throw new Error("Expected supported diode");
      // This literal comes from the historical defect, independently of the
      // importer and of any graph-equality/round-trip comparison.
      expect(written.file.text).toMatch(/^\.model DIODE D\(IS=1e-14 N=1\)$/mu);
      expect(written.file.text).toMatch(/^D1 \S+ \S+ DIODE$/mu);
    },
  );

  it("takes a missing model's type from the explicit symbol, refusing conflicting evidence (#1791)", async () => {
    const text = source(
      "spice",
      ["Q1 c b e OUTSIDE"],
      ['#Q1 @SET-SYMBOL $NPN => @PLACE(0, 0) => @ORIENT("R0")'],
    );
    const result = await read(text, "spice");
    expect([...drawnModelTypes(result.snapshot)]).toEqual([["outside", "npn"]]);
    expect(
      result.project.documents
        .flatMap((document) => document.instances)
        .find((instance) => instance.reference === "Q1")?.symbolId,
    ).toBe("npn");
    const conflict = structuredClone(result.snapshot);
    const level = conflict.levels.find((level) =>
      level.host?.instances.some(
        (instance) => instance.master?.toLowerCase() === "outside",
      ),
    )!;
    const symbol = level.model!.symbols.find(
      (symbol) => symbol.name === "$NPN",
    )!;
    const object = level.model!.objects.find((object) =>
      object.host.includes("#Q1"),
    )!;
    conflict.levels = [
      ...conflict.levels,
      {
        ...structuredClone(level),
        id: "subckt:conflict",
        model: {
          ...structuredClone(level.model!),
          symbols: [{ ...symbol, name: "$PNP" }],
          objects: [{ ...object, symbol: { value: symbol.id } }],
        },
      },
    ];
    expect(drawnModelTypes(conflict).has("outside")).toBe(false);
  });

  it("keeps an undrawn library body as source rather than a new Cell (#1791)", async () => {
    const result = await read(
      source(
        "spice",
        [
          ".subckt hidden A B",
          "Rbody A B 1k",
          ".ends hidden",
          ".subckt dut IN OUT",
          "X1 IN OUT hidden",
        ],
        ['#X1 @PLACE(0, 0) => @ORIENT("R0")'],
      ),
      "spice",
    );
    expect(undrawnBodies(result.snapshot, ["case.sp"])).toEqual(["hidden"]);
    expect(
      result.project.documents.map((document) => document.netlist!.name),
    ).toEqual(["dut"]);
    expect(result.project.externalSubcircuitDefinitions).toEqual([
      expect.objectContaining({
        name: "hidden",
        implementation: expect.objectContaining({
          kind: "source",
          entry: "hidden",
        }),
      }),
    ]);
    const output = createDesignNetlistExport(result.project, {
      format: "spice",
    });
    expect(output.status).toBe("ready");
    if (output.status !== "ready")
      throw new Error("Expected retained source body");
    expect(output.file.text).toMatch(/^\.subckt hidden A B$/mu);
    expect(output.file.text).toMatch(/^Rbody A B 1k$/mu);
  });
});
