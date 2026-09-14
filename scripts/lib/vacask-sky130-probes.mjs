import { readFileSync } from "node:fs";

const reference = (file) =>
  JSON.parse(
    readFileSync(
      new URL(`../../fixtures/simulation-acceptance/${file}`, import.meta.url),
    ),
  );
const core = reference("hosted-sky130-core-continuous-v1.json");
const extra = reference("hosted-sky130-extended-devices-v1.json");

/** Existing hosted thresholds are kept verbatim. This comparison cannot qualify
 * a different model tree by itself; retain actual values and every mismatch. */
export function sky130ProbeChecks(op, ac, corner) {
  const expected = {
    ...core.expectedCorners[corner],
    ...extra.expectedCorners[corner],
  };
  if (!core.expectedCorners[corner] || !extra.expectedCorners[corner])
    throw new Error(`No frozen SKY130 reference for corner ${corner}`);
  const frequency = ac.vectors.find(
    (v) => v.variable.name === "frequency",
  )?.real;
  if (
    frequency?.length !== 1 ||
    !Number.isFinite(frequency[0]) ||
    Math.abs(frequency[0] - 1e9) > 1e-3
  )
    throw new Error(
      "SKY130 capacitor comparison requires its 1 GHz reference point",
    );
  const t = extra.tolerances;
  const probes = [
    [
      "nfetCurrentA",
      op,
      "VDN:flow(br)",
      false,
      core.cornerEvidence.absoluteTolerance,
    ],
    [
      "pfetSourceCurrentA",
      op,
      "VSP:flow(br)",
      false,
      core.cornerEvidence.absoluteTolerance,
    ],
    ["lvtNfetCurrentA", op, "VDNL:flow(br)", false, t.mosCurrentA],
    ["lvtPfetSourceCurrentA", op, "VSPL:flow(br)", false, t.mosCurrentA],
    ["resistorOutputV", op, "rout", false, t.resistorVoltageV],
    ["resistorSupplyCurrentA", op, "VRIN:flow(br)", false, t.resistorCurrentA],
    ["pnpEmitterCurrentA", op, "VPE:flow(br)", false, t.pnpCurrentA],
    ["pnpCollectorCurrentA", op, "VPC:flow(br)", false, t.pnpCurrentA],
    ["mimOutputReal", ac, "capout", false, t.mimComplex],
    ["mimOutputImag", ac, "capout", true, t.mimComplex],
  ];
  return probes.map(([name, plot, vectorName, imaginary, absolute]) => {
    const v = plot.vectors.find((v) => v.variable.name === vectorName);
    const samples = imaginary ? v?.imag : v?.real;
    if (
      plot.pointCount !== 1 ||
      samples?.length !== 1 ||
      !Number.isFinite(samples[0])
    )
      throw new Error(
        `Missing or invalid SKY130 ${corner} probe ${vectorName}`,
      );
    const actual = samples[0];
    const difference = Math.abs(actual - expected[name]);
    return {
      name,
      actual,
      expected: expected[name],
      absolute,
      difference,
      relativeError: difference / Math.abs(expected[name]),
      passed: difference <= absolute,
    };
  });
}
