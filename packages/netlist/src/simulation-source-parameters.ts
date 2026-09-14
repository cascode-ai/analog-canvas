import { inspectVacaskSource } from "./vacask-source.js";
import { vacaskValueToProject } from "./vacask-values.js";

/** Reversible native assignments on a Canvas source. Unknown native programs
 * belong in authored files; they are not constrained by this editing subset. */
export function parseEditableSourceParameters(
  text: string,
):
  | { ok: true; parameters: Record<string, string> }
  | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message });
  if (/[\r\n;]|\/\/|\/\*/u.test(text))
    return fail("A source edit cannot add statements or comments.");
  const parsed = inspectVacaskSource("source", text);
  if (parsed.diagnostics.length || parsed.statements.length !== 1)
    return fail("Finish the native source assignments before applying.");
  const tokens = parsed.statements[0]!.tokens;
  const values = new Map<string, string>();
  let depth = 0;
  const starts: number[] = [];
  for (const [i, token] of tokens.entries()) {
    if (!depth && token.kind === "word" && tokens[i + 1]?.value === "=")
      starts.push(i);
    if (token.kind === "symbol" && ["(", "["].includes(token.value)) depth++;
    if (token.kind === "symbol" && [")", "]"].includes(token.value)) depth--;
  }
  if (starts[0] !== 0 || depth)
    return fail("Use native name=value assignments on this source.");
  for (const [index, start] of starts.entries()) {
    const key = tokens[start]!.value;
    if (values.has(key)) return fail(`Duplicate source parameter ${key}.`);
    const value = text
      .slice(
        tokens[start + 1]!.end,
        tokens[starts[index + 1] ?? tokens.length]?.start ?? text.length,
      )
      .trim();
    if (!value) return fail(`Finish ${key} before applying.`);
    values.set(key, value);
  }
  const kind = /^"(dc|pulse|sine|pwl)"$/u.exec(
    values.get("type") ?? '"dc"',
  )?.[1];
  if (!kind)
    return fail('Canvas sources use type="dc", "pulse", "sine" or "pwl".');
  const names: Record<string, string> = {
    dc: "dc",
    mag: "acMagnitude",
    phase: "acPhase",
  };
  if (kind === "pulse")
    Object.assign(names, {
      val0: "low",
      val1: "high",
      delay: "delay",
      rise: "rise",
      fall: "fall",
      width: "width",
      period: "period",
    });
  if (kind === "sine")
    Object.assign(names, {
      sinedc: "offset",
      ampl: "amplitude",
      freq: "frequency",
      delay: "delay",
      theta: "damping",
      tdphase: "phase",
    });
  const parameters: Record<string, string> = {
    waveform: kind === "sine" ? "sin" : kind,
  };
  try {
    for (const [name, value] of values) {
      if (name === "type") continue;
      if (name === "wave" && kind === "pwl") {
        if (!value.startsWith("[") || !value.endsWith("]"))
          return fail("PWL wave needs a native array of time/value pairs.");
        const items: string[] = [];
        let depth = 0,
          start = 1;
        for (let i = 1; i < value.length - 1; i++) {
          if (value[i] === "(") depth++;
          if (value[i] === ")") depth--;
          if (!depth && value[i] === ",") {
            items.push(value.slice(start, i));
            start = i + 1;
          }
        }
        items.push(value.slice(start, -1));
        if (items.length < 4 || items.length % 2 || depth)
          return fail("PWL needs at least two complete time/value pairs.");
        const scalars = items.map((item) =>
          vacaskValueToProject(item).replaceAll(/\s/gu, ""),
        );
        parameters.pwlPoints = scalars
          .reduce<string[]>((pairs, scalar, i) => {
            if (!(i % 2)) pairs.push(`${scalar} ${scalars[i + 1]}`);
            return pairs;
          }, [])
          .join(", ");
      } else {
        const target = Object.hasOwn(names, name) ? names[name] : undefined;
        if (!target)
          return fail(
            `Native parameter ${name} has no reversible mapping on this Canvas source.`,
          );
        parameters[target] = vacaskValueToProject(value);
      }
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (parameters.dc === undefined)
    return fail(
      "Keep an explicit DC value for this Canvas source; authored sources may omit it.",
    );
  if (parameters.acPhase !== undefined && parameters.acMagnitude === undefined)
    return fail("AC phase needs an AC magnitude.");
  const required =
    kind === "pulse"
      ? ["low", "high", "delay", "rise", "fall", "width", "period"]
      : kind === "sine"
        ? ["offset", "amplitude", "frequency"]
        : kind === "pwl"
          ? ["pwlPoints"]
          : [];
  const missing = required.find((name) => parameters[name] === undefined);
  return missing
    ? fail(`Finish ${missing} for the ${kind} waveform.`)
    : { ok: true, parameters };
}
