import { findBuiltInBodies } from "@icm/netlist";
import {
  convertNetlist,
  type SpiceBuiltInBody,
  type SpiceSourceInput,
} from "@icm/spice";

/** Whether a source is native Spectre, by its extension or its first lines. */
export function isSpectreSource(input: SpiceSourceInput): boolean {
  const prefix = new TextDecoder().decode(input.bytes.subarray(0, 512));
  return (
    /\.scs$/iu.test(input.path) ||
    /^\s*(?:simulator\s+lang\s*=\s*spectre|subckt\s)/imu.test(prefix)
  );
}

/**
 * Sources as the ordinary SPICE loader takes them, which keeps ownership of
 * include resolution and import validation: native Spectre converted, and
 * in either dialect the bodies Analog Canvas writes itself found, so that a
 * call of one imports as the block that wrote it. No remote request is
 * necessary.
 */
export function prepareImportSources(inputs: SpiceSourceInput[]): {
  inputs: SpiceSourceInput[];
  builtInBodies: SpiceBuiltInBody[];
} {
  const builtInBodies: SpiceBuiltInBody[] = [];
  const prepared = inputs.map((input) => {
    if (!isSpectreSource(input)) {
      builtInBodies.push(
        ...findBuiltInBodies(
          new TextDecoder().decode(input.bytes),
          "spice",
          input.path,
        ).bodies,
      );
      return input;
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
    } catch {
      throw new Error(
        `${input.path}: save Spectre source as UTF-8 before importing.`,
      );
    }
    // A body Analog Canvas writes itself goes to the converter without the
    // behavioral sources it has no SPICE for.
    const found = findBuiltInBodies(text, "spectre", input.path);
    const converted = convertNetlist({
      text: found.text,
      source: "spectre",
      target: "spice",
      fragment: true,
      withLineOrigins: true,
    });
    if (converted.status === "blocked") {
      const issue = converted.issues[0]!;
      throw new Error(`${input.path}:${issue.line}: ${issue.message}`);
    }
    builtInBodies.push(
      ...found.bodies.flatMap((body) => {
        const line = converted.lineOrigins?.indexOf(body.source.line) ?? -1;
        return line < 0
          ? []
          : [{ ...body, source: { path: input.path, line: line + 1 } }];
      }),
    );
    return {
      path: input.path,
      bytes: new TextEncoder().encode(converted.text),
    };
  });
  return { inputs: prepared, builtInBodies };
}
