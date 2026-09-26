import { describe, expect, it } from "vitest";
import { compileSpiceSources } from "./compiler.js";
import { compareCircuitIR } from "./comparison.js";

async function ir(text: string) {
  const r = await compileSpiceSources(
    [{ path: "ref.cir", bytes: new TextEncoder().encode(text) }],
    "ref.cir",
  );
  expect(r.successful, JSON.stringify(r.diagnostics)).toBe(true);
  return r.ir!;
}
const reference = `.subckt amp IN OUT VDD VSS
M7 OUT IN VSS VSS nfet w=10u l=1u
R1 VDD OUT 10k
.ends amp`;
describe("read-only structural netlist comparison", () => {
  const withValue = (value: string) => reference.replace("10k", value);
  it.each([
    ["0.1u", "100n"],
    ["1u", "1000n"],
    ["1mil", "25.4u"],
    ["-2mil", "-50.8u"],
    ["+001.200e-3", "1.2m"],
    [".5MEGohm", "500k"],
    ["1M", "0.001"],
    ["-0u", "0"],
    ["1e-400", "10e-401"],
    ["1e400", "10e399"],
    ["1e99999999999999999999", "10e99999999999999999998"],
  ])("treats exact equivalent literals %s and %s as equal", async (a, b) => {
    expect(
      compareCircuitIR(await ir(withValue(a)), await ir(withValue(b)), "amp"),
    ).toMatchObject({ status: "equal", differences: [], reasons: [] });
  });
  it.each([
    ["1u", "1.001u"],
    ["1e-400", "2e-400"],
    ["9007199254740992", "9007199254740993"],
    ["1.0000000000000001", "1"],
    ["1e400", "2e400"],
    ["1M", "1MEG"],
    ["-1u", "1u"],
  ])(
    "keeps distinct literals %s and %s distinct without rounding evidence",
    async (a, b) => {
      const result = compareCircuitIR(
        await ir(withValue(a)),
        await ir(withValue(b)),
        "amp",
      );
      expect(result).toMatchObject({ status: "different", reasons: [] });
      expect(result.differences).toEqual([
        {
          kind: "parameter",
          cell: "amp",
          object: "r1.value",
          actual: a,
          expected: b,
        },
      ]);
    },
  );
  it("matches numeric units and ignores internal automatic names, not endpoints", async () => {
    const expected = await ir(
      reference
        .replace("OUT IN", "internal IN")
        .replace("VDD OUT", "VDD internal"),
    );
    const actual = await ir(
      reference
        .replace("OUT IN", "net42 IN")
        .replace("VDD OUT", "VDD net42")
        .replace("10k", "10000"),
    );
    expect(compareCircuitIR(actual, expected, "amp")).toMatchObject({
      status: "equal",
      differences: [],
    });
  });
  it("locates gate, model, size, missing and extra device differences", async () => {
    const expected = await ir(reference);
    const actual = await ir(
      reference
        .replace("OUT IN", "OUT VSS")
        .replace("nfet w=10u", "other w=20u")
        .replace("R1", "R2"),
    );
    const result = compareCircuitIR(actual, expected, "amp");
    expect(result.status).toBe("different");
    expect(result.differences).toContainEqual(
      expect.objectContaining({
        kind: "connection",
        object: "m7:1",
        expected: ["m7:1", "port:in"],
      }),
    );
    expect(result.differences).toContainEqual(
      expect.objectContaining({ kind: "target", object: "m7" }),
    );
    expect(result.differences).toContainEqual(
      expect.objectContaining({ kind: "parameter", object: "m7.w" }),
    );
    expect(result.differences.filter((d) => d.kind === "device")).toHaveLength(
      2,
    );
  });
  it("distinguishes Port order and global scope; never treats Port VDD as global VDD", async () => {
    const expected = await ir(reference);
    const actual = await ir(
      `.global VDD\n${reference.replace("IN OUT VDD VSS", "OUT IN VDD VSS")}`,
    );
    const result = compareCircuitIR(actual, expected, "amp");
    expect(result.status).toBe("different");
    expect(result.differences.some((d) => d.kind === "interface")).toBe(true);
    expect(result.differences.some((d) => d.kind === "scope")).toBe(true);
  });
  it("compares child definitions, not only instance calls", async () => {
    const text = `.subckt child A B\nR1 A B 1k\n.ends child\n.subckt top I O\nX1 I O child\n.ends top`;
    const result = compareCircuitIR(
      await ir(text.replace("1k", "2k")),
      await ir(text),
      "top",
    );
    expect(result).toMatchObject({ status: "different", comparedCells: 2 });
    expect(result.differences).toContainEqual(
      expect.objectContaining({ cell: "child", kind: "parameter" }),
    );
  });
  it("does not claim equality for expressions or model bodies", async () => {
    const expression = await ir(reference.replace("10k", "{R}"));
    expect(compareCircuitIR(expression, expression, "amp").status).toBe(
      "inconclusive",
    );
    const model = await ir(`${reference}\n.model nfet nmos level=1`);
    expect(compareCircuitIR(model, model, "amp").status).toBe("inconclusive");
  });
  it("keeps over-budget literals inconclusive while retaining known differences", async () => {
    const text = withValue("1".repeat(4097));
    const expected = await ir(text);
    const actual = await ir(text.replace("w=10u", "w=20u"));
    const result = compareCircuitIR(actual, expected, "amp");
    expect(result.status).toBe("inconclusive");
    expect(result.reasons).toContainEqual(
      expect.stringContaining("over-budget literal"),
    );
    expect(result.differences).toEqual([
      {
        kind: "parameter",
        cell: "amp",
        object: "m7.w",
        actual: "20u",
        expected: "10u",
      },
    ]);
  });
  it("reports a missing literal parameter rather than confusing it with zero", async () => {
    const text = reference.replace("w=10u", "w=0");
    const result = compareCircuitIR(
      await ir(text.replace("w=0 ", "")),
      await ir(text),
      "amp",
    );
    expect(result.status).toBe("different");
    expect(result.differences).toContainEqual({
      kind: "parameter",
      cell: "amp",
      object: "m7.w",
      actual: null,
      expected: "0",
    });
  });
});
