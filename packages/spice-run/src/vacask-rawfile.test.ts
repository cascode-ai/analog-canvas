import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseVacaskRawfile } from "./vacask-rawfile.js";

// These files are captured directly from the pinned standalone VACASK run;
// numerical expectations come from the circuit, not a synthetic serializer.
function fixture(directory: string, name: string): string {
  return readFileSync(
    new URL(`../../../netlists/${directory}/${name}`, import.meta.url),
    "utf8",
  );
}
const divider = () => fixture("vacask-divider", "divider_op.raw");
const dc = () => fixture("vacask-divider", "divider_dc.raw");
const ac = () => fixture("vacask-rc", "rc_ac.raw");
function plot(text: string) {
  const result = parseVacaskRawfile(text);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.plots).toHaveLength(1);
  return result.plots[0]!;
}
function error(text: string) {
  const result = parseVacaskRawfile(text);
  if (result.ok) throw new Error("Expected malformed output to be rejected");
  return result.error;
}

describe("native VACASK ASCII output", () => {
  it("keeps the captured output bytes, including reserved header padding", () => {
    for (const [directory, name, sha256] of [
      [
        "vacask-custom-model",
        "custom_op.raw",
        "8267242c4e8f45edbca42b80dae3ffa7dcf3b0ec8bad37d172dfc0972c64d076",
      ],
      [
        "vacask-divider",
        "divider_op.raw",
        "dc3783912860c8a6d21bce0492c53506fdfe0147e534a3c46cf34d2640a92fc2",
      ],
      [
        "vacask-divider",
        "divider_dc.raw",
        "a4f47c6b142033c02fe8d1404e6123011c97b4d8915e4166a9a80e10cc82980f",
      ],
      [
        "vacask-rc",
        "rc_ac.raw",
        "5b798c0cfdf03ff6fd29a2c4d0c879fa588d0bc2000b90bccbe18f0c6634b5a5",
      ],
      [
        "vacask-resistor-noise",
        "resistor_noise.raw",
        "43ed8e5893449fc9580ea4619c5c689012006b031aa0c1fa4c396b1a130ef2fe",
      ],
    ] as const) {
      expect(
        createHash("sha256").update(fixture(directory, name)).digest("hex"),
      ).toBe(sha256);
    }
  });
  it("retains untyped vectors and the physical current sign", () => {
    const op = plot(divider());
    expect(op.pointCount).toBe(1);
    expect(op.command).toBe("");
    expect(
      op.vectors.every(
        (v) => v.variable.quantity === "notype" && v.imag === null,
      ),
    ).toBe(true);
    expect(
      op.vectors.find((v) => v.variable.name === "output")!.real[0],
    ).toBeCloseTo(2, 9);
    expect(
      op.vectors.find((v) => v.variable.name === "V1:flow(br)")!.real[0],
    ).toBeCloseTo(-0.001, 12);
  });

  it("reads measured Linux output from a freshly compiled Verilog-A model", () => {
    const result = plot(fixture("vacask-custom-model", "custom_op.raw"));
    expect(result.pointCount).toBe(1);
    expect(result.vectors.map((v) => [v.variable.name, v.real])).toEqual([
      ["V1:flow(br)", [-0.005]],
      ["input", [2.5]],
    ]);
  });

  it("reads contiguous indexed points and preserves a native OP sweep axis", () => {
    const sweep = plot(dc());
    expect(sweep.pointCount).toBe(7);
    const axis = sweep.vectors.find((v) => v.variable.name === "supply")!.real;
    const out = sweep.vectors.find((v) => v.variable.name === "output")!.real;
    expect(axis).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    out.forEach((value, index) =>
      expect(value).toBeCloseTo((axis[index]! * 2) / 3, 9),
    );
  });

  it("preserves both AC components and agrees with the RC transfer function", () => {
    const result = plot(ac());
    const frequency = result.vectors.find(
      (v) => v.variable.name === "frequency",
    )!;
    const output = result.vectors.find((v) => v.variable.name === "output")!;
    expect(result.complex).toBe(true);
    expect(result.pointCount).toBe(13);
    expect(frequency.imag!.every((value) => value === 0)).toBe(true);
    frequency.real.forEach((f, i) => {
      const x = 2 * Math.PI * f * 0.001;
      expect(output.real[i]).toBeCloseTo(1 / (1 + x * x), 9);
      expect(output.imag![i]).toBeCloseTo(-x / (1 + x * x), 9);
    });
  });

  it("preserves native noise PSD rather than treating it as amplitude density", () => {
    const result = plot(fixture("vacask-resistor-noise", "resistor_noise.raw"));
    const noise = result.vectors.find((v) => v.variable.name === "onoise")!;
    const expected = 4 * 1.380649e-23 * 300 * 1000;
    noise.real.forEach((v) =>
      expect(Math.abs(v / expected - 1)).toBeLessThan(1e-5),
    );
  });

  it("can read independently collected plots concatenated for inspection", () => {
    const result = parseVacaskRawfile(divider() + ac());
    expect(result.ok && result.plots.length).toBe(2);
  });

  it("accepts CRLF without rewriting native names", () => {
    expect(plot(dc().replace(/\r?\n/gu, "\r\n"))).toEqual(plot(dc()));
  });

  it("rejects missing values, surplus points and incorrect point indices", () => {
    const text = dc();
    const dataStart = text.indexOf("Values:\n") + "Values:\n".length;
    const head = text.slice(0, dataStart);
    const data = text.slice(dataStart).trimEnd().split("\n");
    expect(error(head + data.slice(0, -1).join("\n")).code).toBe(
      "point-count-mismatch",
    );
    expect(error(head + data.join("\n") + "\n 7\t1\n").code).toBe(
      "point-count-mismatch",
    );
    expect(error(head + data.join("\n").replace(/^\s*0\t/u, " 9\t")).code).toBe(
      "point-block-invalid",
    );
  });

  it.each(["nan", "inf", "1e999", ""])(
    "does not fabricate a value for %s",
    (token) => {
      const text = divider();
      const dataStart = text.indexOf("Values:\n") + "Values:\n".length;
      const mutated =
        text.slice(0, dataStart) +
        text.slice(dataStart).replace(/(\s*0\t)\S+/u, `$1${token}`);
      expect(parseVacaskRawfile(mutated).ok).toBe(false);
    },
  );

  it("rejects contradictory complex flags and binary output explicitly", () => {
    expect(error(ac().replace("Flags: complex", "Flags: real")).code).toBe(
      "value-malformed",
    );
    expect(error(divider().replace("Values:", "Binary:")).code).toBe(
      "unsupported-format",
    );
  });

  it("rejects incomplete headers and hostile counts without allocating from them", () => {
    expect(error("").code).toBe("empty-file");
    expect(error("Title: incomplete\n").code).toBe("header-incomplete");
    expect(
      error(
        divider().replace(
          /No\. Variables: \d+/u,
          "No. Variables: 9007199254740992",
        ),
      ).code,
    ).toBe("header-invalid");
    expect(
      error(divider().replace(/No\. Points: \d+/u, "No. Points: 999999999"))
        .code,
    ).toBe("point-count-mismatch");
  });
});
