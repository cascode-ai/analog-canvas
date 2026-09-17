import type { SimulationSpecCondition } from "@icm/simulation-service/contract";

const prefixes = [
  "a",
  "f",
  "p",
  "n",
  "µ",
  "m",
  "",
  "k",
  "M",
  "G",
  "T",
  "P",
  "E",
];
const scalable = new Set(["V", "A", "s", "Hz", "F", "H", "Ω", "W", "S"]);
const number = (value: number) => String(Number(value.toPrecision(7)));

/** Presentation only: judgments and CSV retain the original unrounded values. */
export function formatSpecValues(
  value: number | null,
  expected: SimulationSpecCondition | null,
  declaredUnit: string,
) {
  const unit =
    declaredUnit === "Ohm" || declaredUnit === "ohm" ? "Ω" : declaredUnit;
  const reference =
    value ??
    (expected?.kind === "range" ? expected.maximum : expected?.value) ??
    0;
  let exponent = 0;
  if (scalable.has(unit) && reference !== 0) {
    const candidate = Math.floor(Math.log10(Math.abs(reference)) / 3) * 3;
    exponent = candidate >= -18 && candidate <= 18 ? candidate : 0;
    // Avoid displaying a rounded 1000 mV where 1 V is clearer.
    if (
      Math.abs(Number((reference / 10 ** exponent).toPrecision(7))) >= 1000 &&
      candidate >= -18 &&
      candidate <= 18 &&
      exponent < 18
    )
      exponent += 3;
  }
  const values = [
    value,
    ...(expected?.kind === "range"
      ? [expected.minimum, expected.maximum]
      : expected?.kind === "target"
        ? [expected.value, expected.tolerance]
        : expected
          ? [expected.value]
          : []),
  ];
  if (
    values.some(
      (n) =>
        n !== null &&
        n !== 0 &&
        (!Number.isFinite(n / 10 ** exponent) || n / 10 ** exponent === 0),
    )
  )
    exponent = 0;
  const format = (n: number) => number(n / 10 ** exponent);
  const result = value === null ? "—" : format(value);
  const condition = !expected
    ? "—"
    : expected.kind === "limit"
      ? `${expected.operator} ${format(expected.value)}`
      : expected.kind === "range"
        ? `[${format(expected.minimum)}, ${format(expected.maximum)}]`
        : `${format(expected.value)} ± ${format(expected.tolerance)}`;
  return {
    result,
    condition,
    unit: unit
      ? `${scalable.has(unit) ? prefixes[exponent / 3 + 6] : ""}${unit}`
      : "?",
  };
}
