import {
  hasRnlCommentRecords,
  type AgentLocalModelTypes,
  type AgentLocalSource,
} from "@icm/agent-adapter";
import { deriveStableId, type CircuitProject } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import type { RnlAppearance } from "@icm/rnl";
import {
  decodeSourceContent,
  importSpiceSources,
  isSpectreSource,
  type SpiceCompileOptions,
  type SpiceDiagnostic,
  type SpiceSourceInput,
} from "@icm/spice";
import { withImportedInstanceDisplays } from "../features/instance-display/imported-instance-displays";
import {
  givenModelTypesUsed,
  prepareImportSources,
} from "../features/netlist-export/convert-import-sources";

type LocalCircuitInput = SpiceSourceInput & { sha256: string };

/** Keep exact delivered hashes and files alongside the compiler's parsed spans. */
function retainSourceFiles(
  project: CircuitProject,
  inputs: LocalCircuitInput[],
): CircuitProject {
  const parsed = new Map(project.source.files.map((file) => [file.path, file]));
  const originals = inputs.map(({ path, bytes, sha256 }) => {
    const file = parsed.get(path);
    parsed.delete(path);
    const hash = `sha256:${sha256}`;
    return file
      ? { ...file, hash }
      : {
          id: deriveStableId("source", path),
          path,
          hash,
          content: decodeSourceContent(bytes),
        };
  });
  return {
    ...project,
    source: {
      ...project.source,
      files: [
        ...originals,
        ...[...parsed.values()].map((file) => ({
          ...file,
          hash: `derived-${file.hash}`,
        })),
      ],
    },
  };
}

export async function importLocalCircuit(
  inputs: LocalCircuitInput[],
  entryPath: string,
  options: {
    appearance?: RnlAppearance;
    modelTypes?: AgentLocalModelTypes;
  } = {},
) {
  const entry = inputs.find((input) => input.path === entryPath);
  if (!entry) throw new Error("The source bundle does not contain its entry");
  if (/\.icproj(?:\.json)?$/iu.test(entryPath)) {
    if (inputs.length !== 1)
      throw new Error("A native Project takes one Project file");
    return {
      project: parseProject(decodeSourceContent(entry.bytes).text),
      format: "project",
      drawing: "native",
      electrical: "not-verified",
      diagnostics: [] as AgentLocalSource["diagnostics"],
    } as const;
  }
  const compileOptions: SpiceCompileOptions = { includeRoot: "workspace" };
  const rich = inputs.some(
    ({ path, bytes }) =>
      !/\.rnl$/iu.test(path) &&
      hasRnlCommentRecords(decodeSourceContent(bytes).text),
  );
  if (rich) {
    const [{ planRnlImport }, { loadRnlRuntime }] = await Promise.all([
      import("../features/netlist-export/rnl-import"),
      import("../features/netlist-export/rnl-runtime"),
    ]);
    const result = await planRnlImport({
      inputs,
      entryPath,
      runtime: await loadRnlRuntime(),
      compileOptions,
      appearance: options.appearance,
      ...(options.modelTypes ? { modelTypes: options.modelTypes } : {}),
      undeclaredModels: "give-type",
    });
    if (result.status === "failed")
      throw importError(result.diagnostics, result.message);
    const diagnostics: AgentLocalSource["diagnostics"] = [
      ...diagnosticsOf(result.diagnostics),
      ...givenTypesReport(result.modelTypesUsed),
    ];
    return {
      project: retainSourceFiles(result.project, inputs),
      format: "rnl",
      drawing: result.drawing,
      electrical: result.drawing === "discarded" ? "not-verified" : "verified",
      diagnostics,
    } as const;
  }
  const prepared = prepareImportSources(inputs);
  // A card the sources give decides, then a native card's own type, then
  // what the Agent states.
  const given = options.modelTypes ?? {};
  const result = await importSpiceSources(
    prepared.inputs,
    entryPath,
    compileOptions,
    {
      originalSources: inputs,
      builtInBodies: prepared.builtInBodies,
      modelTypes: new Map([...Object.entries(given), ...prepared.modelTypes]),
      undeclaredModels: "give-type",
    },
  );
  if (!result.successful || !result.project)
    throw importError(result.diagnostics, "Structural netlist import failed");
  const used = givenModelTypesUsed(given, result.project, [
    ...(result.ir?.models.map((model) => model.name) ?? []),
    ...prepared.modelTypes.keys(),
  ]);
  const diagnostics: AgentLocalSource["diagnostics"] = [
    ...diagnosticsOf([...prepared.diagnostics, ...result.diagnostics]),
    ...givenTypesReport(used),
  ];
  return {
    project: retainSourceFiles(
      withImportedInstanceDisplays(result.project),
      inputs,
    ),
    format: isSpectreSource(entry) ? "spectre" : "spice",
    drawing: "not-provided",
    electrical: "not-verified",
    diagnostics,
  } as const;
}

/** Names the device types the Agent gave that typed a part. */
function givenTypesReport(
  used: readonly [string, string][],
): AgentLocalSource["diagnostics"] {
  if (!used.length) return [];
  const types = used.map(([name, type]) => `${name}=${type}`).join(", ");
  return [
    {
      code: "LOCAL_MODEL_TYPES_GIVEN",
      severity: "warning",
      message: `Drawn with the device types the Agent gave, as no delivered card declares them: ${types}.`,
    },
  ];
}

function diagnosticsOf(
  diagnostics: SpiceDiagnostic[],
): AgentLocalSource["diagnostics"] {
  return diagnostics.flatMap(({ code, message, severity }) =>
    severity === "info" ? [] : [{ code, message, severity }],
  );
}

function importError(diagnostics: SpiceDiagnostic[], fallback: string): Error {
  const first = diagnostics.find((item) => item.severity === "error");
  return new Error(first ? `${first.code}: ${first.message}` : fallback);
}
