import type { CircuitProject } from "@icm/model";
import { findBuiltInBodies } from "@icm/netlist";
import {
  convertNetlist,
  decodeSourceContent,
  isSpectreSource,
  netlistDeclarations,
  type ConvertedStatementLine,
  type ExternalCall,
  type SpiceBuiltInBody,
  type SpiceDiagnostic,
  type SpiceSourceInput,
} from "@icm/spice";

export { isSpectreSource } from "@icm/spice";

/**
 * Of the device types a caller gave, those that typed a part: a model its
 * parts call that no card, converted native card or drawing types.
 */
export function givenModelTypesUsed(
  given: Readonly<Record<string, string>>,
  project: CircuitProject,
  typed: Iterable<string>,
): [string, string][] {
  const known = new Set([...typed].map((name) => name.toLowerCase()));
  const called = new Set(
    project.documents.flatMap((document) =>
      document.instances.flatMap(({ importProvenance }) =>
        importProvenance?.kind === "model"
          ? [importProvenance.sourceMasterName.toLowerCase()]
          : [],
      ),
    ),
  );
  return Object.entries(given).filter(
    ([name]) =>
      called.has(name.toLowerCase()) && !known.has(name.toLowerCase()),
  );
}

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
 * necessary. A native MOS model card the converter does not translate gives
 * its instances their device type (`modelTypes`, for the importer) and
 * stays out of the converted text, with a warning.
 *
 * The design is read whole (#2294): every file's declarations classify every
 * other file's calls, a master nothing declares is a call of it, kept as
 * written, and every file's refusals are listed, not only the first.
 */
export type NativeStatementLine =
  ConvertedStatementLine | { line: number; dropped: "built-in body" };

/** What another reading of the same files, or the caller, says. */
export interface ImportEvidence {
  externalSubcircuitNames?: readonly string[];
  externalSubcircuitCalls?: readonly string[];
  /** Device types the caller states for models no card declares. */
  modelTypes?: Readonly<Record<string, string>>;
  /** The caller takes device types itself (an Agent's delivery). */
  givesModelTypes?: boolean;
}

const TYPE_DESIGNATOR: Record<string, string> = {
  nmos: "M",
  pmos: "M",
  npn: "Q",
  pnp: "Q",
  njf: "J",
  pjf: "J",
  d: "D",
};

export function prepareImportSources(
  inputs: readonly SpiceSourceInput[],
  evidence: ImportEvidence = {},
): {
  inputs: SpiceSourceInput[];
  builtInBodies: SpiceBuiltInBody[];
  modelTypes: Map<string, string>;
  diagnostics: SpiceDiagnostic[];
  /** Located refusals of every file; with any, nothing imports. */
  refusals: SpiceDiagnostic[];
  /** Each native Spectre file's statements by first line, with why one
   * printed nothing: what the statement ledger accounts by. */
  nativeStatements: Map<string, NativeStatementLine[]>;
  /** A call of a master nothing declares, by converted file and line, with
   * the name it was written with: its Reference. */
  callReferences: Map<string, string>;
  originalLocation(
    path: string,
    line: number,
  ): { path: string; line: number } | undefined;
} {
  const builtInBodies: SpiceBuiltInBody[] = [];
  const modelTypes = new Map<string, string>();
  const diagnostics: SpiceDiagnostic[] = [];
  const refusals: SpiceDiagnostic[] = [];
  const nativeStatements = new Map<string, NativeStatementLine[]>();
  const callReferences = new Map<string, string>();
  const calls: (ExternalCall & { path: string })[] = [];
  const originsByPath = new Map<
    string,
    (line: number) => { path: string; line: number } | undefined
  >();
  const refuse = (message: string) =>
    refusals.push({
      code: "SPICE_CONVERSION_BLOCKED",
      severity: "error",
      stage: "import",
      message,
    });
  // Every file's declarations, so a call is classified by the design, not
  // by the one file it sits in; then the types the caller states.
  const subcircuitNames: string[] = [];
  const declaredModels: Record<string, string> = {};
  // Spectre tells names apart by case; SPICE, which reads the converted
  // design, joins them: two spellings of one name in native files cannot
  // be read without merging what the author kept apart.
  const spellings = new Map<string, Map<string, string>>();
  for (const input of inputs) {
    const native = isSpectreSource(input);
    const declarations = netlistDeclarations(
      decodeSourceContent(input.bytes).text,
      native ? "spectre" : "spice",
    );
    subcircuitNames.push(...declarations.subcircuits);
    for (const [name, designator] of Object.entries(declarations.models))
      declaredModels[name.toLowerCase()] = designator;
    if (!native) continue;
    for (const { kind, name, line } of declarations.spellings) {
      const key = `${kind}:${name.toLowerCase()}`;
      const spelled = spellings.get(key) ?? new Map<string, string>();
      if (!spelled.has(name)) spelled.set(name, `${input.path}:${line}`);
      spellings.set(key, spelled);
    }
  }
  for (const spelled of spellings.values())
    if (spelled.size > 1)
      refuse(
        `Names differ only in case, which SPICE reads as one: ${[...spelled]
          .map(([name, at]) => `${name} (${at})`)
          .join(", ")}`,
      );
  if (refusals.length)
    return {
      inputs: [],
      builtInBodies,
      modelTypes,
      diagnostics,
      refusals,
      nativeStatements,
      callReferences,
      originalLocation: (path, line) => ({ path, line }),
    };
  for (const [name, type] of Object.entries(evidence.modelTypes ?? {})) {
    const designator = TYPE_DESIGNATOR[type.toLowerCase()];
    if (designator && !(name.toLowerCase() in declaredModels))
      declaredModels[name.toLowerCase()] = designator;
  }
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
      refuse(`${input.path}: save Spectre source as UTF-8 before importing.`);
      return [];
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
      externalNativeModels: true,
      // A design read from the user's own files has no service to protect.
      unbounded: true,
      importsDesign: true,
      subcircuitNames,
      declaredModels,
      ...(evidence.externalSubcircuitNames
        ? { externalSubcircuitNames: evidence.externalSubcircuitNames }
        : {}),
      ...(evidence.externalSubcircuitCalls
        ? { externalSubcircuitCalls: evidence.externalSubcircuitCalls }
        : {}),
    });
    if (converted.status === "blocked") {
      for (const issue of converted.issues)
        refuse(`${input.path}:${issue.line}: ${issue.message}`);
      return [];
    }
    for (const issue of converted.issues)
      diagnostics.push({
        code: "SPICE_CONVERSION_VALUE_KEPT",
        severity: "warning",
        stage: "import",
        message: `${input.path}:${issue.line}: ${issue.message}`,
      });
    // A body Analog Canvas writes itself reaches the converter blanked,
    // line for line: its statements are that body's definition.
    const foundLines = found.text.split(/\r\n?|\n/u);
    const blanked = new Set(
      text
        .split(/\r\n?|\n/u)
        .flatMap((line, index) =>
          line.trim() && !foundLines[index]?.trim() ? [index + 1] : [],
        ),
    );
    nativeStatements.set(input.path, [
      ...(converted.statementLines ?? []),
      ...[...blanked].map((line) => ({
        line,
        dropped: "built-in body" as const,
      })),
    ]);
    const reported = new Set<number>();
    for (const model of converted.externalModels ?? []) {
      modelTypes.set(model.name, model.type);
      if (reported.has(model.line)) continue;
      reported.add(model.line);
      diagnostics.push({
        code: "SPICE_CONVERSION_MODEL_EXTERNAL",
        severity: "warning",
        stage: "import",
        message: `${input.path}:${model.line}: ${model.native} model ${model.name} is drawn as ${model.type} and not converted; simulating it in Analog Canvas needs a converted model.`,
      });
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
      originsByPath.set(path, (line) => ({
        path: input.path,
        line: from + line - 1,
      }));
      sectionFiles.push({
        path,
        bytes: new TextEncoder().encode(
          `${lines.slice(from - 1, to).join("\n")}\n`,
        ),
      });
      kept.push(`.include "${path.split("/").at(-1)}"`);
      origins.push(origin);
    });
    // A call keeps the name it was written with, which SPICE prefixed.
    for (const call of converted.externalCalls ?? []) {
      calls.push({ ...call, path: input.path });
      const at = kept.findIndex(
        (line, index) =>
          origins[index] === call.line && line.startsWith(`${call.written} `),
      );
      if (at >= 0) callReferences.set(`${input.path}:${at + 1}`, call.name);
    }
    builtInBodies.push(
      ...found.bodies.flatMap((body) => {
        const line = origins.indexOf(body.source.line);
        return line < 0
          ? []
          : [{ ...body, source: { path: input.path, line: line + 1 } }];
      }),
    );
    originsByPath.set(input.path, (line) => {
      const original = origins[line - 1];
      return original ? { path: input.path, line: original } : undefined;
    });
    return [
      { path: input.path, bytes: new TextEncoder().encode(kept.join("\n")) },
      ...sectionFiles,
    ];
  });
  // One master takes one port count: calls that differ name a mistake, or
  // two masters of one name, and neither can be guessed.
  const byMaster = new Map<string, (ExternalCall & { path: string })[]>();
  for (const call of calls)
    byMaster.set(call.master.toLowerCase(), [
      ...(byMaster.get(call.master.toLowerCase()) ?? []),
      call,
    ]);
  for (const group of byMaster.values())
    if (new Set(group.map(({ ports }) => ports)).size > 1)
      refuse(
        `${group[0]!.master} is called with ${[...new Set(group.map(({ ports }) => ports))].join(" and ")} ports: ${group
          .map(
            ({ path, line, name, ports }) =>
              `${path}:${line} ${name} (${ports})`,
          )
          .join(", ")}`,
      );
  // What a master nothing declares came in as, and how to draw it as the
  // device it may be.
  if (calls.length) {
    const named = [...byMaster.values()].map(
      (group) =>
        `${group[0]!.master} (${group
          .slice(0, 3)
          .map(({ name }) => name)
          .join(
            ", ",
          )}${group.length > 3 ? `, and ${group.length - 3} more` : ""})`,
    );
    diagnostics.push({
      code: "SPICE_IMPORT_EXTERNAL_CALLS",
      // A part may be a device drawn as a box: worth an Agent's attention.
      severity: "warning",
      stage: "import",
      message: `No declaration in the design names ${named.join(", ")}: each comes in as a call of its master, with its ports in order and its parameters as written. To draw one as a device, include the library that defines it${evidence.givesModelTypes ? ', or give its device type in modelTypes, such as {"' + calls[0]!.master + '":"nmos"}' : ""}.`,
    });
  }
  return {
    inputs: prepared.flat(),
    builtInBodies,
    modelTypes,
    diagnostics,
    refusals,
    nativeStatements,
    callReferences,
    originalLocation(path, line) {
      const locate = originsByPath.get(path);
      return locate ? locate(line) : { path, line };
    },
  };
}

/**
 * The line of a source record's original text that a line of its parsed text
 * came from. Converting the original again, with the design's other files'
 * declarations, must give the parsed text the record holds; otherwise the
 * lines cannot be matched.
 */
export function originalSourceLine(
  record: CircuitProject["source"]["files"][number],
  line: number,
  design: readonly CircuitProject["source"]["files"][number][] = [record],
): number | undefined {
  if (!record.originalContent) return line;
  try {
    const prepared = prepareImportSources(
      [record, ...design.filter((file) => file.path !== record.path)].flatMap(
        (file) => {
          const text = (file.originalContent ?? file.content)?.text;
          return text === undefined
            ? []
            : [{ path: file.path, bytes: new TextEncoder().encode(text) }];
        },
      ),
    );
    const parsed = prepared.inputs.find(({ path }) => path === record.path);
    if (
      !parsed ||
      decodeSourceContent(parsed.bytes).text !== record.content?.text
    )
      return undefined;
    const location = prepared.originalLocation(record.path, line);
    return location?.path === record.path ? location.line : undefined;
  } catch {
    return undefined;
  }
}
