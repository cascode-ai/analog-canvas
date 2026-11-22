import {
  reviewedExternalBindingById,
  projectLengthToSky130Micrometres,
  sky130MicrometresToProjectLength,
} from "@icm/devices";
import { parseSpiceNumber } from "@icm/spice";
import type { DesignNetlistInstance, DesignNetlistParameter } from "./ir.js";

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

/** A SPICE number: digits, a scale and a unit, as `spectreNumber` reads it. */
const SPICE_NUMBER =
  /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[tgkmunpfa])?([\p{L}°]*)\s*$/iu;

/**
 * A number as Spectre writes it, where Analog Canvas holds it as SPICE does:
 * the digits as written, the scale in Spectre's spelling (SPICE's Meg is
 * Spectre's M, and SPICE's M milli), and no unit after it, which Spectre
 * does not read (100fF as 100f, 1MegΩ as 1M). A SPICE {expression} loses its
 * braces, which Spectre does not read, and is parenthesized where it has
 * spaces, which would end a Spectre value; a number in braces is that number
 * ({10meg} as 10M); anything else, such as a bare name, as it is.
 */
export function spectreNumber(raw: string): string {
  const braced = /^\s*\{([^{}]*)\}\s*$/u.exec(raw);
  if (braced) {
    const expression = braced[1]!.trim();
    if (SPICE_NUMBER.test(expression)) return spectreNumber(expression);
    return /\s/u.test(expression) ? `(${expression})` : expression;
  }
  const match = SPICE_NUMBER.exec(raw);
  if (!match) return raw;
  const [, digits, scale = "", unit = ""] = match;
  if (!scale && !unit) return raw;
  // A micro sign is a scale SPICE readers disagree on: left as written.
  if (/^[µμ]/u.test(unit)) return raw;
  if (scale.toLowerCase() === "mil")
    return String(Number((Number(digits) * 25.4e-6).toPrecision(15)));
  return `${digits}${SPECTRE_SCALE[scale.toLowerCase()] ?? ""}`;
}

/** A Spectre number as Analog Canvas holds it, spelled as SPICE spells it; an
 * expression or a name regains the braces SPICE needs around it. */
function spiceNumberFromSpectre(text: string): string {
  const match =
    /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([TGMKkmunpfa])?\s*$/u.exec(
      text,
    );
  if (!match) {
    const expression = text.trim();
    if (!expression || /^\{.*\}$/su.test(expression)) return text;
    // The parentheses spectreNumber added around a spaced expression.
    const spaced = /^\(([^()]*\s[^()]*)\)$/u.exec(expression);
    return `{${spaced ? spaced[1]!.trim() : expression}}`;
  }
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

/**
 * Whether a reviewed device's call gives this count again as `m`, the
 * parallel multiplier, as its PDK's own symbols do: SKY130's MIM and poly
 * resistor wrappers read mf or mult only to scale their mismatch (#2447).
 * Not for a count of exactly 1, which `m` would not change, nor when the part
 * gives its own `m`, which the call prints as it is.
 */
export function printsParallelM(
  instance: Pick<
    DesignNetlistInstance,
    "reviewedExternalBindingId" | "parameters"
  >,
  parameter: DesignNetlistParameter,
): boolean {
  const binding = reviewedExternalBindingById(
    instance.reviewedExternalBindingId,
  );
  return (
    !!binding?.parameters.some(
      (p) =>
        p.alsoParallelM &&
        p.name.toLowerCase() === parameter.name.toLowerCase(),
    ) &&
    parseSpiceNumber(parameter.rawValue)?.value !== 1 &&
    !instance.parameters.some((p) => p.name.toLowerCase() === "m")
  );
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
