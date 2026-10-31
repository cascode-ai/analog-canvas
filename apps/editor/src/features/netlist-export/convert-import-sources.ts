import { findBuiltInBodies } from "@icm/netlist";
import {
  convertNetlist,
  isSpectreSource,
  type SpiceBuiltInBody,
  type SpiceSourceInput,
} from "@icm/spice";

export { isSpectreSource } from "@icm/spice";

/** The lines (1-based, inclusive) of each SPICE section of a Spectre source. */
function spiceSections(
  lines: readonly string[],
): { from: number; to: number }[] {
  const sections: { from: number; to: number }[] = [];
  let open: number | null = null;
  lines.forEach((raw, index) => {
    const language = /^simulator\s+lang\s*=\s*(\w+)$/iu.exec(raw.trim());
    if (!language) return;
    if (language[1]!.toLowerCase() === "spice") open ??= index + 2;
    else if (open !== null) {
      sections.push({ from: open, to: index });
      open = null;
    }
  });
  if (open !== null) sections.push({ from: open, to: lines.length });
  return sections;
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
      return [input];
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
      // A model library the export wrote as SPICE (#1933) is read as it is.
      uncountedSpiceSections: true,
    });
    if (converted.status === "blocked") {
      const issue = converted.issues[0]!;
      throw new Error(`${input.path}:${issue.line}: ${issue.message}`);
    }
    // Each SPICE section is its own SPICE file, its bytes as written, which
    // the converted source includes where the section stood: a model library
    // the export wrote as SPICE (#1933) reads back as the SPICE it is.
    const lines = text.split(/\r\n?|\n/u);
    const sections = spiceSections(lines);
    const output = converted.text.split("\n");
    const kept: string[] = [];
    const origins: number[] = [];
    const sectionFiles: SpiceSourceInput[] = [];
    output.forEach((line, index) => {
      const origin = converted.lineOrigins?.[index] ?? 0;
      const section = sections.findIndex(
        ({ from, to }) => origin >= from && origin <= to,
      );
      if (section < 0) {
        kept.push(line);
        origins.push(origin);
        return;
      }
      const path = `${input.path}.section${section + 1}.sp`;
      if (sectionFiles.some((file) => file.path === path)) return;
      const { from, to } = sections[section]!;
      sectionFiles.push({
        path,
        bytes: new TextEncoder().encode(
          `${lines.slice(from - 1, to).join("\n")}\n`,
        ),
      });
      kept.push(`.include "${path.split("/").at(-1)}"`);
      origins.push(origin);
    });
    builtInBodies.push(
      ...found.bodies.flatMap((body) => {
        const line = origins.indexOf(body.source.line);
        return line < 0
          ? []
          : [{ ...body, source: { path: input.path, line: line + 1 } }];
      }),
    );
    return [
      { path: input.path, bytes: new TextEncoder().encode(kept.join("\n")) },
      ...sectionFiles,
    ];
  });
  return { inputs: prepared.flat(), builtInBodies };
}
