import {
  reviewedExternalBindingById,
  projectLengthToSky130Micrometres,
  sky130MicrometresToProjectLength,
} from "@icm/devices";
import type { DesignNetlistInstance } from "./ir.js";

/** Internal value projection, not an editable-policy or persisted contract. */
export type PrintedParameterConversion =
  "identity" | "sky130-micrometres" | "spectre-number";

/** SPICE's scale suffixes, as Spectre spells them. */
const SPECTRE_SCALE: Readonly<Record<string, string>> = {
  t: "T",
  g: "G",
  meg: "M",
  k: "k",
  m: "m",
  u: "u",
  n: "n",
  p: "p",
  f: "f",
  a: "a",
};

/**
 * A number as Spectre writes it, where Analog Canvas holds it as SPICE does:
 * the digits as written, the scale in Spectre's spelling (SPICE's Meg is
 * Spectre's M, and SPICE's M milli), and no unit after it, which Spectre
 * does not read (100fF as 100f, 1MegΩ as 1M). Anything else, such as an
 * expression or a name, as it is.
 */
export function spectreNumber(raw: string): string {
  const match =
    /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[tgkmunpfa])?([\p{L}°]*)\s*$/iu.exec(
      raw,
    );
  if (!match) return raw;
  const [, digits, scale = "", unit = ""] = match;
  if (!scale && !unit) return raw;
  if (scale.toLowerCase() === "mil")
    return String(Number((Number(digits) * 25.4e-6).toPrecision(15)));
  return `${digits}${SPECTRE_SCALE[scale.toLowerCase()] ?? ""}`;
}

/** A Spectre number as Analog Canvas holds it, spelled as SPICE spells it. */
function spiceNumberFromSpectre(text: string): string {
  const match =
    /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([TGMKkmunpfa])?\s*$/u.exec(
      text,
    );
  if (!match) return text;
  const [, digits, scale = ""] = match;
  return `${digits}${scale === "M" ? "Meg" : scale === "K" ? "k" : scale}`;
}

export function printedParameterConversion(
  instance: Pick<DesignNetlistInstance, "reviewedExternalBindingId">,
  parameter: string,
): PrintedParameterConversion {
  const binding = reviewedExternalBindingById(
    instance.reviewedExternalBindingId,
  );
  return binding?.parameters.find(
    (p) => p.name.toLowerCase() === parameter.toLowerCase(),
  )?.targetUnit === "micrometre"
    ? "sky130-micrometres"
    : "identity";
}

/** Native syntax decoding/validation belongs to the caller. Ordinary Netlist
 * also accepts authored SI literals; Circuit keeps its plain-um input policy. */
export function restorePrintedParameter(
  value: string,
  conversion: PrintedParameterConversion,
  allowSiLiteral = false,
): string {
  if (conversion === "identity") return value;
  if (conversion === "spectre-number") return spiceNumberFromSpectre(value);
  if (allowSiLiteral && /[a-z]$/iu.test(value.trim())) {
    // Use the same geometry grammar as forward export, including "250 n".
    // A suffix candidate is not proof: the owner rejects invalid/unknown units.
    projectLengthToSky130Micrometres(value);
    return value;
  }
  return sky130MicrometresToProjectLength(value);
}
