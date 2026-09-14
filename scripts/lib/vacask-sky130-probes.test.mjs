import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sky130ProbeChecks } from "./vacask-sky130-probes.mjs";
const reference = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../fixtures/simulation-acceptance/${name}`, import.meta.url),
    ),
  );
const core = reference("hosted-sky130-core-continuous-v1.json");
const extended = reference("hosted-sky130-extended-devices-v1.json");
function samples(corner) {
  const r = {
    ...core.expectedCorners[corner],
    ...extended.expectedCorners[corner],
  };
  const names = {
    "VDN:flow(br)": "nfetCurrentA",
    "VSP:flow(br)": "pfetSourceCurrentA",
    "VDNL:flow(br)": "lvtNfetCurrentA",
    "VSPL:flow(br)": "lvtPfetSourceCurrentA",
    rout: "resistorOutputV",
    "VRIN:flow(br)": "resistorSupplyCurrentA",
    "VPE:flow(br)": "pnpEmitterCurrentA",
    "VPC:flow(br)": "pnpCollectorCurrentA",
  };
  return [
    {
      pointCount: 1,
      vectors: Object.entries(names).map(([name, key]) => ({
        variable: { name },
        real: [r[key]],
      })),
    },
    {
      pointCount: 1,
      vectors: [
        { variable: { name: "frequency" }, real: [1e9] },
        {
          variable: { name: "capout" },
          real: [r.mimOutputReal],
          imag: [r.mimOutputImag],
        },
      ],
    },
  ];
}
describe("native model comparison against frozen hosted evidence", () => {
  it.each(["tt", "ff", "ss", "fs", "sf"])(
    "retains all ten %s probes and original thresholds",
    (corner) => {
      const checks = sky130ProbeChecks(...samples(corner), corner);
      expect(checks).toHaveLength(10);
      expect(checks.every((c) => c.passed)).toBe(true);
      expect(checks.find((c) => c.name === "nfetCurrentA").absolute).toBe(
        core.cornerEvidence.absoluteTolerance,
      );
      expect(checks.find((c) => c.name === "lvtNfetCurrentA").absolute).toBe(
        extended.tolerances.mosCurrentA,
      );
    },
  );
  it("retains other probes and reports mismatch without loosening tolerance", () => {
    const [op, ac] = samples("ff");
    op.vectors[0].real[0] *= 1.01;
    const checks = sky130ProbeChecks(op, ac, "ff");
    expect(checks.filter((c) => !c.passed).map((c) => c.name)).toEqual([
      "nfetCurrentA",
    ]);
    expect(checks[0].relativeError).toBeCloseTo(0.01);
    expect(checks).toHaveLength(10);
  });
  it("rejects missing vectors, wrong AC frequency and unknown corner", () => {
    const [op, ac] = samples("tt");
    expect(() => sky130ProbeChecks({ ...op, vectors: [] }, ac, "tt")).toThrow(
      "Missing or invalid",
    );
    ac.vectors[0].real[0] = 1e6;
    expect(() => sky130ProbeChecks(op, ac, "tt")).toThrow("1 GHz");
    ac.vectors[0].real[0] = NaN;
    expect(() => sky130ProbeChecks(op, ac, "tt")).toThrow("1 GHz");
    expect(() => sky130ProbeChecks(op, ac, "unknown")).toThrow("No frozen");
  });
  it("rejects nonfinite probes and multiple samples rather than selecting a convenient point", () => {
    const [op, ac] = samples("tt");
    op.vectors[0].real[0] = NaN;
    expect(() => sky130ProbeChecks(op, ac, "tt")).toThrow("Missing or invalid");
    const [multiple, singleAc] = samples("tt");
    multiple.pointCount = 2;
    expect(() => sky130ProbeChecks(multiple, singleAc, "tt")).toThrow(
      "Missing or invalid",
    );
  });
});
