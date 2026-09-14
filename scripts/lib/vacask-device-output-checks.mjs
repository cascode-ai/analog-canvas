/** Output semantics qualification, not model correction. All mismatches remain
 * evidence and prevent treating a model variable as a qualified terminal value. */
export function deviceOutputChecks(bias, ac, nderivative, pderivative) {
  const vector = (plot, name, imaginary = false) => {
    const item = plot.vectors.find((v) => v.variable.name === name);
    const values = imaginary ? item?.imag : item?.real;
    if (
      !values?.length ||
      values.length !== plot.pointCount ||
      values.some((v) => !Number.isFinite(v))
    )
      throw Error(`Missing/invalid device output: ${name}`);
    return values;
  };
  if (
    bias.pointCount !== 1 ||
    ac.pointCount !== 1 ||
    nderivative.pointCount !== 3 ||
    pderivative.pointCount !== 3
  )
    throw Error(
      "Device output proof requires one bias/AC and three DC points per polarity",
    );
  const checks = [];
  const compare = (
    name,
    actual,
    expected,
    absolute = 1e-12,
    relative = 1e-6,
  ) => {
    if (!Number.isFinite(actual) || !Number.isFinite(expected))
      throw Error(`Non-finite derived device output: ${name}`);
    const difference = Math.abs(actual - expected);
    checks.push({
      name,
      actual,
      expected,
      absolute,
      relative,
      difference,
      passed: difference <= absolute + relative * Math.abs(expected),
    });
  };
  compare("AC frequency (Hz)", vector(ac, "frequency")[0], 1);
  for (const [prefix, sign, center, derivative, axis] of [
    ["N", 1, 1, nderivative, "ngate"],
    ["P", -1, -1, pderivative, "pgate"],
  ]) {
    for (const [i, expected] of [
      center - 1e-5,
      center,
      center + 1e-5,
    ].entries())
      compare(
        `${prefix} DC axis ${i} (V)`,
        vector(derivative, axis)[i],
        expected,
      );
    const current = (name) => -vector(bias, `VD${name}:flow(br)`)[0];
    const one = current(`${prefix}1`),
      three = current(`${prefix}3`);
    if (sign * one <= 0)
      throw Error(`${prefix}: unexpected physical drain-current direction`);
    compare(`${prefix} total drain current multiplicity (A)`, three, 3 * one);
    for (const parameter of ["id", "gm"])
      compare(
        `${prefix} model ${parameter} remains per-instance`,
        vector(bias, `${prefix}3.${parameter}`)[0],
        vector(bias, `${prefix}1.${parameter}`)[0],
      );
    compare(
      `${prefix} normalized model vgs (V)`,
      vector(bias, `${prefix}1.vgs`)[0],
      1,
    );
    compare(
      `${prefix} normalized model vds (V)`,
      vector(bias, `${prefix}1.vds`)[0],
      1.8,
    );
    compare(`${prefix} model vbs (V)`, vector(bias, `${prefix}1.vbs`)[0], 0);
    // These are model-native outputs, not yet a claim about total derivatives.
    for (const parameter of ["gds", "gmbs", "vth", "vdsat"])
      vector(bias, `${prefix}1.${parameter}`);
    const samples = vector(derivative, `VD${prefix}1:flow(br)`);
    const step = vector(derivative, axis)[2] - vector(derivative, axis)[0];
    if (!(step > 0)) throw Error(`${prefix}: invalid DC derivative interval`);
    const finiteDifference = -(samples[2] - samples[0]) / step;
    const acDerivative = -vector(ac, `VD${prefix}1:flow(br)`)[0];
    compare(
      `${prefix} AC versus DC terminal transconductance (S)`,
      acDerivative,
      finiteDifference,
      1e-8,
      1e-4,
    );
    compare(
      `${prefix} AC total derivative multiplicity (S)`,
      -vector(ac, `VD${prefix}3:flow(br)`)[0],
      3 * acDerivative,
      1e-10,
      1e-6,
    );
    // Deliberately tests, rather than assumes, whether gm may label a terminal
    // transconductance in GUI. Failure is not fixed by rescaling native output.
    compare(
      `${prefix} model gm versus terminal transconductance (S)`,
      vector(bias, `${prefix}1.gm`)[0],
      finiteDifference,
      1e-8,
      1e-4,
    );
  }
  return checks;
}
