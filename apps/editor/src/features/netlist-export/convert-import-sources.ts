import type { CircuitProject } from "@icm/model";
import { findBuiltInBodies } from "@icm/netlist";
import {
  convertNetlist,
  decodeSourceContent,
  isSpectreSource,
  MODEL_TYPE_DESIGNATOR,
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

/** A path as an include names it, relative to the including file. */
function includedPath(from: string, path: string): string {
  const parts = [...from.split("/").slice(0, -1), ...path.split("/")];
  const resolved: string[] = [];
  for (const part of parts)
    if (part === "..") resolved.pop();
    else if (part && part !== ".") resolved.push(part);
  return resolved.join("/");
}

/** The device type a call of these ports could be given, by its letter. */
function typeExample(name: string, ports: number): string | undefined {
  const letter = name[0]?.toUpperCase();
  if (letter === "M" && ports === 4) return "nmos";
  if (letter === "Q" && (ports === 3 || ports === 4)) return "npn";
  if (letter === "J" && ports === 3) return "njf";
  if (letter === "D" && ports === 2) return "d";
  return undefined;
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
 * The design is read whole (#2294): every file's declarations, in the
 * library sections its includes select, classify every other file's calls;
 * a master nothing declares is a call of it, kept as written; and every
 * file's refusals are listed, each where it is.
 */
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
  /** Where each refusal is: the statement ledger lists them. */
  refusedStatements: { path: string; line: number; reason: string }[];
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
  const refusedStatements: { path: string; line: number; reason: string }[] =
    [];
  const nativeStatements = new Map<string, NativeStatementLine[]>();
  const callReferences = new Map<string, string>();
  const calls: (ExternalCall & { path: string })[] = [];
  const originsByPath = new Map<
    string,
    (line: number) => { path: string; line: number } | undefined
  >();
  const refuse = (
    message: string,
    at: readonly { path: string; line: number }[] = [],
  ) => {
    refusals.push({
      code: "SPICE_CONVERSION_BLOCKED",
      severity: "error",
      stage: "import",
      message,
    });
    for (const { path, line } of at)
      refusedStatements.push({ path, line, reason: message });
  };
  // Every file's declarations, so a call is classified by the design, not
  // by the one file it sits in: those in no library section, and those in
  // a section some include selects; then the types the caller states.
  const declared = inputs.map((input) => ({
    input,
    native: isSpectreSource(input),
    declarations: netlistDeclarations(
      decodeSourceContent(input.bytes).text,
      isSpectreSource(input) ? "spectre" : "spice",
    ),
  }));
  const selected = new Set(
    declared.flatMap(({ input, declarations }) =>
      declarations.includes.map(
        ({ path, section }) =>
          `${includedPath(input.path, path)}\u0000${section}`,
      ),
    ),
  );
  const counts = (path: string, section: string | undefined) =>
    !section || selected.has(`${path}\u0000${section}`);
  const subcircuitNames: string[] = [];
  const declaredModels: Record<string, string> = {};
  // Spectre tells names apart by case; SPICE, which reads the converted
  // design, joins them: two spellings of one name in native files cannot
  // be read without merging what the author kept apart.
  const spellings = new Map<
    string,
    Map<string, { path: string; line: number }>
  >();
  // A card in a section no include selects declares nothing and types
  // nothing: no part draws with it.
  const unselectedModels = new Set<string>();
  for (const { input, native, declarations } of declared) {
    for (const { name, section } of declarations.subcircuits)
      if (counts(input.path, section)) subcircuitNames.push(name);
    for (const { name, designator, line, section } of declarations.models)
      if (counts(input.path, section))
        declaredModels[name.toLowerCase()] = designator;
      else unselectedModels.add(`${input.path}:${line}`);
    if (!native) continue;
    for (const { kind, name, line } of declarations.spellings) {
      const key = `${kind}:${name.toLowerCase()}`;
      const spelled = spellings.get(key) ?? new Map();
      if (!spelled.has(name)) spelled.set(name, { path: input.path, line });
      spellings.set(key, spelled);
    }
  }
  for (const spelled of spellings.values())
    if (spelled.size > 1)
      refuse(
        `Names differ only in case, which SPICE reads as one: ${[...spelled]
          .map(([name, { path, line }]) => `${name} (${path}:${line})`)
          .join(", ")}`,
        [...spelled.values()],
      );
  if (refusals.length)
    return {
      inputs: [],
      builtInBodies,
      modelTypes,
      diagnostics,
      refusals,
      refusedStatements,
      nativeStatements,
      callReferences,
      originalLocation: (path, line) => ({ path, line }),
    };
  for (const [name, type] of Object.entries(evidence.modelTypes ?? {})) {
    const designator = MODEL_TYPE_DESIGNATOR[type.toLowerCase()];
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
      refuse(`${input.path}: save Spectre source as UTF-8 before importing.`, [
        { path: input.path, line: 1 },
      ]);
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
        refuse(`${input.path}:${issue.line}: ${issue.message}`, [
          { path: input.path, line: issue.line },
        ]);
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
      if (unselectedModels.has(`${input.path}:${model.line}`)) continue;
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
        group,
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
    // A type only where a call's letter and ports fit a family that has
    // one: a capacitor master takes none.
    const typed = calls
      .map((call) => ({ call, type: typeExample(call.name, call.ports) }))
      .find(({ type }) => type);
    diagnostics.push({
      code: "SPICE_IMPORT_EXTERNAL_CALLS",
      // A part may be a device drawn as a box: worth an Agent's attention.
      severity: "warning",
      stage: "import",
      message: `No declaration in the design names ${named.join(", ")}: each comes in as a call of its master, with its ports in order and its parameters as written. To draw one as a device, include the library that defines it${evidence.givesModelTypes && typed ? `, or give its device type in modelTypes, such as {"${typed.call.master}":"${typed.type}"}` : ""}.`,
    });
  }
  return {
    inputs: prepared.flat(),
    builtInBodies,
    modelTypes,
    diagnostics,
    refusals,
    refusedStatements,
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
