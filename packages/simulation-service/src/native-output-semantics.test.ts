import { describe, expect, it } from "vitest";
import {
  nativeOutputDeclarations,
  nativeProbeMeaning,
} from "./native-output-semantics.js";
import { evaluateSimulationOutputs } from "./output-evaluation.js";

const declarations = (code: string) =>
  nativeOutputDeclarations(
    [{ path: "run.cir", text: `* test\n.control\n${code}\n.endc\n.end\n` }],
    "run.cir",
  );
const probes = [
  { name: "v(in)", quantity: "voltage", unit: "V", real: [1, 1], imag: [0, 0] },
  {
    name: "v(out)",
    quantity: "voltage",
    unit: "V",
    real: [0.5, 0.01],
    imag: [-0.5, -0.1],
  },
  {
    name: "gain_db",
    quantity: "decibel",
    unit: null,
    real: [-3.0103, -20],
    imag: [0, 0],
  },
  {
    name: "phase_deg",
    quantity: "notype",
    unit: null,
    real: [-45, -84.3],
    imag: [0, 0],
  },
];
describe("native result meaning (not AC storage shape)", () => {
  it("bounds alias depth and memoizes repeated semantic dependencies", () => {
    const code = [
      "let x0 = v(out)",
      ...Array.from({ length: 64 }, (_, i) => `let x${i + 1} = x${i} + x${i}`),
    ].join("\n");
    const source = declarations(code);
    expect(
      nativeProbeMeaning({ ...probes[3]!, name: "x24" }, probes, true, source),
    ).toMatchObject({ unit: "V", semantics: { valueKind: "complex" } });
    expect(
      nativeProbeMeaning({ ...probes[3]!, name: "x64" }, probes, true, source)
        .semantics.valueKind,
    ).toBe("unknown");
  });
  it("keeps RC dB/degree expressions real while retaining complex zero-imaginary input", () => {
    const source = declarations(
      "let gain_db = db(v(out)/v(in))\nlet phase_deg = 180/PI*cph(v(out)/v(in))",
    );
    const result = evaluateSimulationOutputs(
      {
        schemaVersion: 1,
        analyses: [
          {
            analysis: "ac",
            plotName: "AC Analysis",
            frequencyHz: [1591.55, 1e4],
            probes,
          },
        ],
      },
      [],
      [],
      [],
      [],
      true,
      {},
      source,
    );
    const out = result.analyses[0]!.outputs;
    expect(out[0]).toMatchObject({
      imaginary: [0, 0],
      semantics: { valueKind: "complex" },
    });
    expect(out[2]).toMatchObject({
      unit: "dB",
      values: [-3.0103, -20],
      semantics: { valueKind: "real", origin: "expression" },
    });
    expect(out[3]).toMatchObject({
      unit: "deg",
      values: [-45, -84.3],
      semantics: { valueKind: "real" },
    });
    expect(out[2]).not.toHaveProperty("imaginary");
    expect(out[3]).not.toHaveProperty("imaginary");
    expect(probes[3]!.imag).toEqual([0, 0]);
  });
  it("uses expressions and aliases, never suggestive names", () => {
    const source = declarations(
      "let H = v(out)/v(in)\nlet funny = 180/PI*cph(H)\nlet gain_db = H\nlet r = real(v(out))",
    );
    expect(
      nativeProbeMeaning(
        { ...probes[3]!, name: "funny" },
        probes,
        true,
        source,
      ),
    ).toMatchObject({ unit: "deg", semantics: { valueKind: "real" } });
    expect(nativeProbeMeaning(probes[2]!, probes, true, source)).toMatchObject({
      unit: "1",
      semantics: { valueKind: "complex" },
    });
    expect(
      nativeProbeMeaning({ ...probes[1]!, name: "r" }, probes, true, source),
    ).toMatchObject({ unit: "V", semantics: { valueKind: "real" } });
    expect(
      nativeProbeMeaning(
        { ...probes[3]!, name: "mystery_deg" },
        probes,
        true,
        source,
      ),
    ).toMatchObject({ unit: "", semantics: { valueKind: "unknown" } });
  });
  it("does not guess repeated assignments or evaluate recursive/unsupported programs", () => {
    const source = declarations(
      "let x = db(v(out))\nlet x = cph(v(out))\nlet y = z\nlet z = y\nlet custom = user_function(v(out))",
    );
    for (const name of ["x", "y", "z", "custom"])
      expect(
        nativeProbeMeaning({ ...probes[3]!, name }, probes, true, source)
          .semantics.valueKind,
      ).toBe("unknown");
  });
  it("ignores an unreferenced source file", () => {
    const source = nativeOutputDeclarations(
      [
        {
          path: "run.cir",
          text: "* test\n.control\nlet a = real(v(out))\n.endc",
        },
        { path: "unused.cir", text: ".control\nlet a = db(v(out))\n.endc" },
      ],
      "run.cir",
    );
    expect(source.get("a")).toBe("real(v(out))");
  });
  it("does not reinterpret an earlier alias or a conditional program", () => {
    for (const code of [
      "let x = later\nlet later = db(v(out))",
      "if flag\nlet x = db(v(out))\nend",
    ]) {
      expect(
        nativeProbeMeaning(
          { ...probes[3]!, name: "x" },
          probes,
          true,
          declarations(code),
        ).semantics.valueKind,
      ).toBe("unknown");
    }
  });
});
