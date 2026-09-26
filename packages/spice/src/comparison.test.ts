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
});
