import { parameterExpressionBody } from "@icm/devices";
import { parseSpiceNumber, splitSpiceFields } from "@icm/spice";
import {
  PULSE_PARAMETER_NAMES,
  SIN_REQUIRED_PARAMETER_NAMES,
  SIN_OPTIONAL_PARAMETER_NAMES,
} from "./source-waveform.js";

/** The reversible Canvas subset, not a general native-SPICE parser. */
export function parseEditableSourceParameters(
  text: string,
):
  | { ok: true; parameters: Record<string, string> }
  | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message });
  const body = text.replace(/\r?\n\+[ \t]*/gu, " ");
  if (/[\r\n;]/u.test(body))
    return fail("A source edit cannot add statements or comments.");
  const tokens = splitSpiceFields(
    body.replace(/\b(PULSE|SIN|PWL)\s+\(/giu, "$1("),
  );
  const parameters: Record<string, string> = { waveform: "dc" };
  const valid = (value: string | undefined): value is string =>
    value !== undefined &&
    (parameterExpressionBody(value) !== undefined ||
      Number.isFinite(parseSpiceNumber(value)?.value));
  let waveform = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const key = token.toUpperCase();
    if (key === "DC" || (i === 0 && valid(token))) {
      if (parameters.dc !== undefined) return fail("Use only one DC value.");
      const value = key === "DC" ? tokens[++i] : token;
      if (!valid(value))
        return fail("Finish the DC number or braced expression.");
      parameters.dc = value;
    } else if (key === "AC") {
      if (parameters.acMagnitude !== undefined)
        return fail("Use only one AC clause.");
      const magnitude = tokens[++i];
      if (!valid(magnitude))
        return fail(
          "Finish AC magnitude, followed by optional phase in degrees.",
        );
      parameters.acMagnitude = magnitude;
      if (valid(tokens[i + 1])) parameters.acPhase = tokens[++i]!;
    } else {
      const match = /^(PULSE|SIN|PWL)\((.*)\)$/iu.exec(token);
      if (!match || waveform)
        return fail(
          "Use DC, AC magnitude [phase], and one PULSE(...), SIN(...) or PWL(...) waveform.",
        );
      waveform = true;
      const name = match[1]!.toLowerCase();
      const values = splitSpiceFields(match[2]!);
      if (!values.every(valid))
        return fail(
          "Waveform arguments must be numbers or braced expressions.",
        );
      parameters.waveform = name;
      if (name === "pwl") {
        if (values.length < 4 || values.length % 2)
          return fail("PWL needs at least two time/value pairs.");
        parameters.pwlPoints = values
          .reduce<string[]>((pairs, value, index) => {
            if (index % 2 === 0) pairs.push(`${value} ${values[index + 1]}`);
            return pairs;
          }, [])
          .join(", ");
      } else {
        const names =
          name === "pulse"
            ? PULSE_PARAMETER_NAMES
            : [
                ...SIN_REQUIRED_PARAMETER_NAMES,
                ...SIN_OPTIONAL_PARAMETER_NAMES,
              ];
        const required = name === "pulse" ? 7 : 3;
        if (values.length < required || values.length > names.length)
          return fail(
            `${name.toUpperCase()} requires ${required}${required === names.length ? "" : `–${names.length}`} arguments in this Canvas source.`,
          );
        values.forEach((value, index) => {
          parameters[names[index]!] = value;
        });
      }
    }
  }
  if (parameters.dc === undefined)
    return fail(
      "Keep an explicit DC value for this Canvas source; native text-only sources may omit it.",
    );
  return { ok: true, parameters };
}
