import type { DeviceDescriptor } from "./contract.js";

export type DeviceParameterIssue =
  | {
      kind: "unknown";
      name: string;
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
    };

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

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
      if (!options.open) issues.push({ kind: "unknown", name });
      continue;
    }
    if (definition.editor === "select") {
      const allowed = (definition.options ?? []).map((option) => option.value);
      if (!allowed.includes(rawValue))
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
    }
  }
  return issues;
}
