import type { DeviceDescriptor } from "./contract.js";
import { parameterExpressionBody } from "./parameter-expression.js";

export type DeviceParameterIssue =
  | {
      kind: "unknown";
      name: string;
      /** The known name it most likely meant, if one is close. */
      suggestion?: string;
    }
  | {
      kind: "duplicate";
      name: string;
      previousName: string;
    }
  | {
      kind: "select";
      name: string;
      value: string;
      allowed: readonly string[];
    }
  | {
      kind: "decimal";
      name: string;
      value: string;
    }
  | {
      /** A quantity that is neither a SPICE number nor an expression. */
      kind: "number";
      name: string;
      value: string;
    };

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
/**
 * The SPICE number the exporter writes as-is: a scale suffix and unit
 * letters may follow, which ngspice 46 ignores ("9kΩ" is 9k). "µ" is not
 * among them: ngspice would read "1µ" as 1, so it is refused.
 */
const SPICE_NUMBER =
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:meg|mil|[tgkmunpfa])?[a-zΩΩ]*$/iu;
/** Point lists are read by the source compiler, not as one number. */
const LIST_PARAMETERS = new Set(["pwlpoints"]);

/** A quantity field holds a number, an expression, or nothing yet. */
function isQuantity(value: string): boolean {
  const text = value.trim();
  return (
    text === "" ||
    SPICE_NUMBER.test(text) ||
    parameterExpressionBody(text) !== undefined
  );
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++)
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[right.length]!;
}

/** "freq" means "frequency"; "widht" means "width". Nothing far off. */
function closestName(
  name: string,
  known: readonly string[],
): string | undefined {
  const folded = name.toLowerCase();
  const prefixed = known.filter((candidate) =>
    candidate.toLowerCase().startsWith(folded),
  );
  if (folded.length >= 2 && prefixed.length === 1) return prefixed[0];
  let best: { name: string; distance: number } | undefined;
  for (const candidate of known) {
    const distance = editDistance(folded, candidate.toLowerCase());
    if (distance <= 2 && distance < (best?.distance ?? Infinity))
      best = { name: candidate, distance };
  }
  return best?.name;
}

/**
 * Validate the authored parameter slots owned by a device's model.
 *
 * Values remain strings because they are passed to the selected simulator, but
 * editor metadata still defines which names and scalar forms the GUI accepts.
 * The returned issues are deliberately data-only so clients and diagnostics can
 * present the same failure without mutating a document. An `open` model (an
 * unreviewed external or hierarchical subcircuit) takes names beyond its known
 * slots, so only the known ones are checked; see `instanceParameterContract`.
 */
export function validateDeviceParameters(
  descriptor: Pick<DeviceDescriptor, "parameters">,
  parameters: Readonly<Record<string, string>>,
  options: { open?: boolean } = {},
): readonly DeviceParameterIssue[] {
  const definitions = new Map(
    descriptor.parameters.map((parameter) => [
      parameter.name.toLowerCase(),
      parameter,
    ]),
  );
  const issues: DeviceParameterIssue[] = [];
  const seen = new Map<string, string>();
  for (const [name, rawValue] of Object.entries(parameters)) {
    const folded = name.toLowerCase();
    const previousName = seen.get(folded);
    if (previousName !== undefined) {
      issues.push({ kind: "duplicate", name, previousName });
      continue;
    }
    seen.set(folded, name);
    const definition = definitions.get(folded);
    if (!definition) {
      if (!options.open) {
        const suggestion = closestName(
          name,
          descriptor.parameters.map((parameter) => parameter.name),
        );
        issues.push({
          kind: "unknown",
          name,
          ...(suggestion ? { suggestion } : {}),
        });
      }
      continue;
    }
    if (definition.editor === "select") {
      const allowed = (definition.options ?? []).map((option) => option.value);
      if (
        !allowed.includes(rawValue) &&
        !definition.options?.some((option) =>
          option.spellings?.includes(rawValue),
        )
      )
        issues.push({
          kind: "select",
          name,
          value: rawValue,
          allowed,
        });
    } else if (
      definition.editor === "decimal" &&
      (!DECIMAL.test(rawValue.trim()) || !Number.isFinite(Number(rawValue)))
    ) {
      issues.push({ kind: "decimal", name, value: rawValue });
    } else if (
      // A text field with a unit is a quantity; one without may be a word.
      definition.editor === "text" &&
      definition.unitHint !== undefined &&
      !LIST_PARAMETERS.has(folded) &&
      !isQuantity(rawValue)
    ) {
      issues.push({ kind: "number", name, value: rawValue });
    }
  }
  return issues;
}

/**
 * The parameters as they are stored: a choice typed in another spelling its
 * option accepts, such as the Unicode minus for an adder's `-`, becomes the
 * option's value. Names match as validation matches them, ignoring case;
 * every other value is kept as given.
 */
export function canonicalParameterValues(
  descriptor: Pick<DeviceDescriptor, "parameters">,
  parameters: Readonly<Record<string, string>>,
): Record<string, string> {
  const definitions = new Map(
    descriptor.parameters.map((parameter) => [
      parameter.name.toLowerCase(),
      parameter,
    ]),
  );
  return Object.fromEntries(
    Object.entries(parameters).map(([name, rawValue]) => [
      name,
      definitions
        .get(name.toLowerCase())
        ?.options?.find((option) => option.spellings?.includes(rawValue))
        ?.value ?? rawValue,
    ]),
  );
}
