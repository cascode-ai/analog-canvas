import {
  hasRnlCommentRecords,
  type AgentLocalSource,
} from "@icm/agent-adapter";
import { deriveStableId, type CircuitProject } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import {
  decodeSourceContent,
  importSpiceSources,
  isSpectreSource,
  type SpiceCompileOptions,
  type SpiceDiagnostic,
  type SpiceSourceInput,
} from "@icm/spice";
import { withImportedInstanceDisplays } from "../features/instance-display/imported-instance-displays";
import { prepareImportSources } from "../features/netlist-export/convert-import-sources";

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
    });
    if (result.status === "failed")
      throw importError(result.diagnostics, result.message);
    return {
      project: retainSourceFiles(result.project, inputs),
      format: "rnl",
      drawing: result.drawing,
      electrical: result.drawing === "discarded" ? "not-verified" : "verified",
      diagnostics: diagnosticsOf(result.diagnostics),
    } as const;
  }
  const prepared = prepareImportSources(inputs);
  const result = await importSpiceSources(
    prepared.inputs,
    entryPath,
    compileOptions,
    {
      originalSources: inputs,
      builtInBodies: prepared.builtInBodies,
    },
  );
  if (!result.successful || !result.project)
    throw importError(result.diagnostics, "Structural netlist import failed");
  return {
    project: retainSourceFiles(
      withImportedInstanceDisplays(result.project),
      inputs,
    ),
    format: isSpectreSource(entry) ? "spectre" : "spice",
    drawing: "not-provided",
    electrical: "not-verified",
    diagnostics: diagnosticsOf(result.diagnostics),
  } as const;
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
