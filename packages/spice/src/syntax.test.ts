import { describe, expect, it } from "vitest";

import { createSourceBundle } from "./source.js";
import { locateSpiceParameterValues } from "./syntax.js";

const encoder = new TextEncoder();

describe("SPICE statement profile", () => {
  it("locates .param value ranges without touching comments, duplicate name text or continuations", async () => {
    const text =
      "* 🧪\r\n.param R = 1k $ R=bad\r\n* R=comment\r\n+ SCALE = {2 * R} C='R / 3'\r\n.end\r\n";
    const bundle = await createSourceBundle(
      [{ path: "params.cir", bytes: encoder.encode(text) }],
      "params.cir",
    );
    const statement = bundle.syntaxFiles[0]!.statements.find(
      (s) => s.kind === "parameter",
    )!;
    if (statement.kind !== "parameter") throw Error("param");
    const ranges = locateSpiceParameterValues(statement);
    expect(
      ranges.map((r) => [r.name, text.slice(r.startOffset, r.endOffset)]),
    ).toEqual([
      ["R", "1k"],
      ["SCALE", "{2 * R}"],
      ["C", "'R / 3'"],
    ]);
  });
  it("normalizes explicit and bare independent-source DC values", async () => {
    const bundle = await createSourceBundle(
      [
        {
          path: "sources.spi",
          bytes: encoder.encode("* sources\nV1 out 0 DC 1.2\nI1 out 0 10u\n"),
        },
      ],
      "sources.spi",
    );
    expect(
      bundle.syntaxFiles[0]!.statements.filter(
        (statement) => statement.kind === "instance",
      ).map((statement) => statement.parameters),
    ).toEqual([
      [expect.objectContaining({ name: "dc", rawText: "1.2" })],
      [expect.objectContaining({ name: "dc", rawText: "10u" })],
    ]);
  });

  it("projects every supported element family and recognizes baseline directives", async () => {
    const text = [
      ".param BASE=1k SCALE={2*BASE}",
      ".model DMOD D (is=1e-15)",
      ".subckt all A B C D",
      "R1 A B {BASE}",
      "C1 A B 2p",
      "L1 A B 3n",
      "V1 A B 1",
      "I1 A B 2u",
      "E1 A B C D 4",
      "G1 A B C D 5m",
      "F1 A B V1 6",
      "H1 A B V1 7",
      "D1 A B DMOD",
      "Q1 A B C DMOD",
      "S1 A B C D DMOD",
      "M1 A B C D DMOD l=1u",
      "X1 A B child p=1",
      ".save A",
      ".ends all",
      "",
    ].join("\n");
    const bundle = await createSourceBundle(
      [{ path: "all.spi", bytes: encoder.encode(text) }],
      "all.spi",
    );
    const statements = bundle.syntaxFiles[0]!.statements;
    const instances = statements.filter(
      (statement) => statement.kind === "instance",
    );
    expect(instances.map((statement) => statement.family)).toEqual([
      "resistor",
      "capacitor",
      "inductor",
      "voltage-source",
      "current-source",
      "vcvs",
      "vccs",
      "cccs",
      "ccvs",
      "diode",
      "bjt",
      "switch",
      "mosfet",
      "subcircuit",
    ]);
    expect(instances[0]!.parameters[0]!.rawText).toBe("{BASE}");
    expect(instances.at(-1)!.master).toBe("child");
    expect(
      statements.find(
        (statement) =>
          statement.kind === "directive" && statement.name === "save",
      )?.rawText,
    ).toBe(".save A");
    expect(bundle.diagnostics).toEqual([]);
  });
});
