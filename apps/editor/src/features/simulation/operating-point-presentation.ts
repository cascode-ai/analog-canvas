import type {
  Prepared,
  SimulationOutputData,
} from "@icm/simulation-service/contract";

type Analysis = SimulationOutputData["analyses"][number];
type Measurement = NonNullable<SimulationOutputData["measurements"]>[number];

/** Old receipts may contain automatic copies of OP samples. Hide only a
 * corroborated copy; authored rules, failures and inconsistent evidence survive. */
export function isRedundantOpMeasurement(
  data: SimulationOutputData,
  item: Measurement,
) {
  if (
    item.origin === "authored" ||
    item.analysis !== "op" ||
    item.metric !== "operating-point" ||
    item.status !== "available"
  )
    return false;
  const analysis = data.analyses[item.analysisIndex];
  if (analysis?.analysis !== "op") return false;
  return analysis.outputs.some(
    (output) =>
      output.id === item.outputId &&
      output.unit === item.unit &&
      output.values.length === 1 &&
      !output.imaginary?.some((value) => value !== 0) &&
      output.values[0] === item.value,
  );
}

/** MOS ownership comes from the immutable Prepared mapping, never a display
 * label or a coincidentally equal value. Retain unrecognized native vectors. */
export function operatingPointOutputs(
  data: SimulationOutputData,
  analysisIndex: number,
  prepared?: Pick<Prepared, "vectors" | "deviceOperatingPoints">,
): Analysis["outputs"] {
  const analysis = data.analyses[analysisIndex]!;
  if (!prepared || analysis.analysis !== "op") return analysis.outputs;
  const owned = new Set<string>();
  const onlyOp =
    data.analyses.filter((record) => record.analysis === "op").length === 1;
  for (const device of data.deviceOperatingPoints ?? []) {
    if (
      device.analysisIndex === undefined
        ? !onlyOp
        : device.analysisIndex !== analysisIndex
    )
      continue;
    const spec = prepared.deviceOperatingPoints.find(
      (candidate) =>
        candidate.id === device.id &&
        candidate.documentId === device.documentId &&
        candidate.instanceId === device.instanceId &&
        JSON.stringify(candidate.occurrence) ===
          JSON.stringify(device.occurrence),
    );
    if (!spec) continue;
    for (const value of device.values) {
      if (value.status !== "available") continue;
      const expression = spec.values.find(
        (parameter) => parameter.parameter === value.parameter,
      )?.expression;
      if (expression?.kind !== "acquisition") continue;
      const vector = prepared.vectors
        .find((vector) => vector.probeId === expression.acquisitionId)
        ?.vector.toLowerCase();
      if (!vector) continue;
      // Same priority as the service's ngspice device-parameter alias resolver.
      const output = [
        vector,
        ...(vector.startsWith("@") ? [`i(${vector})`, `v(${vector})`] : []),
      ]
        .map((name) =>
          analysis.outputs.find((output) => output.id === `native:${name}`),
        )
        .find((output) => output !== undefined);
      if (
        output &&
        output.values.length === 1 &&
        output.values[0] === value.value &&
        output.unit === value.unit &&
        !output.imaginary?.some((value) => value !== 0)
      )
        owned.add(output.id);
    }
  }
  return analysis.outputs.filter((output) => !owned.has(output.id));
}
