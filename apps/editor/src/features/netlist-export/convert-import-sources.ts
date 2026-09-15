import { convertNetlist, type SpiceSourceInput } from "@icm/spice";

/** Convert only native Spectre inputs; the ordinary SPICE loader keeps ownership
 * of include resolution and import validation. No remote request is necessary. */
export function convertImportSources(
  inputs: SpiceSourceInput[],
): SpiceSourceInput[] {
  return inputs.map((input) => {
    const prefix = new TextDecoder().decode(input.bytes.subarray(0, 512));
    const isSpectre =
      /\.scs$/iu.test(input.path) ||
      /^\s*(?:simulator\s+lang\s*=\s*spectre|subckt\s)/imu.test(prefix);
    if (!isSpectre) return input;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
    } catch {
      throw new Error(
        `${input.path}: save Spectre source as UTF-8 before importing.`,
      );
    }
    const converted = convertNetlist({
      text,
      source: "spectre",
      target: "spice",
      fragment: true,
    });
    if (converted.status === "blocked") {
      const issue = converted.issues[0]!;
      throw new Error(`${input.path}:${issue.line}: ${issue.message}`);
    }
    return {
      path: input.path,
      bytes: new TextEncoder().encode(converted.text),
    };
  });
}
