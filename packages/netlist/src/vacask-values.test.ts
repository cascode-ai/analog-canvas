import { describe, expect, it } from "vitest";
import { vacaskNumber, vacaskValueToProject } from "./vacask-values.js";
import { vacaskProjectValue } from "./vacask-printer.js";

describe("native Circuit scalar reverse mapping", () => {
  it.each([
    ["1M", 1e6],
    ["1m", 1e-3],
    ["1meg", 1e6],
    ["1x", 1e6],
    ["2mil", 50.8e-6],
    ["10kOhm", 10000],
    ["1nF", 1e-9],
    ["0xFF", 255],
    ["-0xA", -10],
    ["-1e-6", -1e-6],
  ] as const)(
    "preserves %s in Project SI and the reprinted native circuit",
    (raw, expected) => {
      expect(vacaskNumber(raw)).toBeCloseTo(expected, 15);
      const project = vacaskValueToProject(raw);
      expect(Number(project)).toBeCloseTo(expected, 15);
      expect(Number(vacaskProjectValue(project))).toBeCloseTo(expected, 15);
    },
  );
  it("translates literals inside expressions without changing native names, grouping or powers", () => {
    expect(vacaskValueToProject("(WIDTH * 1M + 1e-6)")).toBe(
      "{WIDTH * 1000000 + 0.000001}",
    );
    expect(vacaskValueToProject("max(1m,1M) ** 2")).toBe(
      "{max(0.001,1000000) ** 2}",
    );
    expect(vacaskValueToProject("(A)+(a)")).toBe("{(A)+(a)}");
  });
  it.each([
    "",
    "1 2",
    "(BIAS) Rnew",
    "1F",
    "1e3k",
    "nan",
    "Inf",
    "1e500",
    "2^3",
    "A=2",
    "(A",
    "()",
    "max(1,)",
    "{BIAS}",
    "1; quit",
    "1\nR (a 0) r",
    "1/*comment*/",
    "V(OUT)",
    "[1,2]",
  ])("leaves unsupported/incomplete input repairable: %s", (raw) => {
    expect(() => vacaskValueToProject(raw)).toThrow();
  });
});
