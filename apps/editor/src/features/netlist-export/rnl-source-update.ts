import { portableCellIdentifier, sha256Hex } from "@icm/derived";
import type { CircuitProject, StableId } from "@icm/model";
import { createDesignNetlistExport, type NetlistFormat } from "@icm/netlist";
import {
  CANVAS_PACKAGE,
  createRnlExport,
  FILE_LEVEL_CELL,
  rnlBodyPortOrder,
  RNL_SYMBOLS,
  type RnlLevelSnapshot,
  type RnlOp,
  type RnlSnapshot,
} from "@icm/rnl";
import {
  decodeSourceContent,
  isSpectreSource,
  type SpiceSourceInput,
} from "@icm/spice";
import type { RnlRuntime, RnlWritten } from "./rnl-runtime";

/** The original files and circuit of a Project opened from an RNL import. */
export interface RnlImportSource {
  inputs: readonly SpiceSourceInput[];
  entryPath: string;
  project: CircuitProject;
}

/** Apply text to path only if the source file still has sourceSha256. */
export interface RnlSourceUpdate {
  entryPath: string;
  path: string;
  level: string;
  sourceSha256: string;
  text: string;
}

/** The printed netlist retains card identities as well as circuit values. */
function cellNetlist(
  project: CircuitProject,
  documentId: StableId,
  format: NetlistFormat,
): string {
  const result = createDesignNetlistExport(project, {
    format,
    rootDocumentId: documentId,
    groundPin: "as-read",
    callsWithoutBodies: true,
    bodyPortOrder: rnlBodyPortOrder(project),
  });
  if (result.status !== "ready")
    throw new Error(
      result.diagnostics.find(({ severity }) => severity === "error")
        ?.message ?? "The Cell's electrical netlist could not be checked.",
    );
  return result.file.text;
}

const canvasSymbols = new Set(
  RNL_SYMBOLS.filter(({ package: name }) => name === CANVAS_PACKAGE).map(
    ({ symbol }) => symbol,
  ),
);

/** Keep the source's artwork when its header cannot resolve Canvas symbols. */
function opsWithSourceSymbols(
  ops: RnlOp[],
  originalOps: RnlOp[],
  source: {
    packages: RnlSnapshot["packages"];
    level: RnlLevelSnapshot | undefined;
  },
  writerLevel: string,
): RnlOp[] {
  const sourcePackages = new Map(
    source.packages.map(({ name, version }) => [name, version]),
  );
  const model = source.level?.model;
  const symbols = new Map(model?.symbols.map((symbol) => [symbol.id, symbol]));
  const instances = new Map(
    model?.objects
      .filter(({ kind }) => kind === "instance")
      .map(({ id, symbol }) => [id, symbols.get(symbol.value ?? "")]),
  );
  const originalCanvasSymbols = new Map(
    originalOps.flatMap((op) =>
      op.level === writerLevel && op.op === "set" && op.symbol
        ? [[op.object, op.symbol] as const]
        : [],
    ),
  );
  const used = new Set(
    ops.flatMap((op) => (op.op === "use-package" ? [op.name] : [])),
  );
  const added: RnlOp[] = [];
  const rewritten = ops.flatMap((op) => {
    // Without the Canvas package the importer reads label bindings from text.
    if (
      op.op === "add-usage" &&
      (op.definition === "$CANVAS_LABEL" ||
        (op.definition === "$CANVAS_TYPESETTING" &&
          Object.keys(op.params ?? {}).length === 0))
    )
      return [];
    if (
      op.level !== writerLevel ||
      op.op !== "set" ||
      !op.symbol ||
      !canvasSymbols.has(op.symbol) ||
      originalCanvasSymbols.get(op.object) !== op.symbol
    )
      return [op];
    const original = instances.get(op.object);
    const name = original?.package;
    const version = name ? sourcePackages.get(name) : undefined;
    if (!original || !name || !version) return [op];
    if (!used.has(name)) {
      // This declaration is for the temporary writer output. Only its drawing
      // records are carried into the source.
      added.push({ level: writerLevel, op: "use-package", name, version });
      used.add(name);
    }
    return [{ ...op, symbol: original.name }];
  });
  return [...added, ...rewritten];
}

/** The writer's record ranges identify the selected drawing in its own output. */
function recordsForLevel(
  written: RnlWritten,
  name: string,
  fileLevel: boolean,
): string {
  const file = written.document.files?.[0];
  const levels = written.document.levels;
  if (!file || !levels)
    throw new Error("RNL export supplied no record ranges.");
  const subcircuits = levels.flatMap(({ title, lines }) =>
    lines?.[0] === 0 ? [{ title, first: lines[1], last: lines[2] }] : [],
  );
  const subcircuit = fileLevel
    ? undefined
    : subcircuits.find(
        ({ title }) => title.toLowerCase() === name.toLowerCase(),
      );
  if (!fileLevel && !subcircuit)
    throw new Error("RNL export could not identify the current Cell.");
  const lines = file.text.split(/\r\n|\r|\n/u);
  // The writer puts its header first and uses one comment prefix throughout
  // each record. The record's start column gives the length of that prefix.
  const records = file.records
    .slice(1)
    .flatMap(([firstLine, firstColumn, lastLine]) => {
      const belongs = subcircuit
        ? firstLine >= subcircuit.first && lastLine <= subcircuit.last
        : !subcircuits.some(
            ({ first, last }) => firstLine >= first && lastLine <= last,
          );
      return belongs
        ? [
            lines
              .slice(firstLine - 1, lastLine)
              .map((line) => line.slice(firstColumn - 1))
              .join("\n"),
          ]
        : [];
    });
  if (!records.length)
    throw new Error(
      "RNL export produced no drawing records for the current Cell.",
    );
  return records.join("\n") + "\n";
}

/** Write one edited drawing against its source, with the runtime doing the splice. */
export async function prepareRnlSourceUpdate(
  project: CircuitProject,
  documentId: StableId,
  source: RnlImportSource,
  runtime: RnlRuntime | null,
): Promise<RnlSourceUpdate> {
  if (!runtime?.replaceRecords)
    throw new Error("The RNL runtime does not support source updates.");
  const original = source.project.documents.find(({ id }) => id === documentId);
  const current = project.documents.find(({ id }) => id === documentId);
  const netlist = original?.netlist;
  const name = netlist?.name;
  const sourceName = original?.sourceBinding?.cellName;
  if (!netlist || !name || !sourceName || name !== current?.netlist?.name)
    throw new Error(
      "The current Cell cannot be matched to the imported RNL source.",
    );
  const entry = source.inputs.find(({ path }) => path === source.entryPath);
  if (!entry) throw new Error("The imported RNL entry file is unavailable.");
  const dialect = isSpectreSource(entry) ? "spectre" : "spice";
  if (
    cellNetlist(source.project, documentId, dialect) !==
    cellNetlist({ ...project, name: source.project.name }, documentId, dialect)
  )
    throw new Error(
      "The Cell has electrical changes. Update its source netlist first.",
    );
  const workspace = {
    entry: entry.path,
    dialect,
    files: Object.fromEntries(
      source.inputs.map(({ path, bytes }) => [
        path,
        decodeSourceContent(bytes).text,
      ]),
    ),
  } as const;
  const sourceDrawing = await runtime.snapshot({
    ...workspace,
    parts: { drawing: false, host: true, model: true },
  });
  const fileLevel =
    sourceName.toLowerCase() === FILE_LEVEL_CELL && !netlist.terminals.length;
  const drawnFiles = sourceDrawing.levels.filter(
    (level) => level.kind === "file" && level.host?.instances.length,
  );
  if (
    fileLevel &&
    (drawnFiles.length > 1 ||
      sourceDrawing.levels.some(
        (level) =>
          level.kind === "subckt" &&
          level.name.toLowerCase() === FILE_LEVEL_CELL,
      ))
  )
    throw new Error(
      "The imported Cell cannot be matched to one RNL file level.",
    );
  const level = fileLevel
    ? (drawnFiles[0]?.name ?? entry.path.slice(entry.path.lastIndexOf("/") + 1))
    : sourceName;
  const sourceLevel = sourceDrawing.levels.find(
    (item) =>
      item.kind === (fileLevel ? "file" : "subckt") && item.name === level,
  );
  const writerName = portableCellIdentifier(name, documentId);

  // Export the edited drawing in its original Project so other open Cells'
  // edits cannot affect its records or prevent it from being written.
  const exported = createRnlExport(
    {
      ...project,
      topDocumentId: fileLevel ? documentId : source.project.topDocumentId,
      documents: source.project.documents.map((cell) =>
        cell.id === current.id ? current : cell,
      ),
    },
    { format: dialect },
  );
  if (exported.status === "blocked")
    throw new Error(
      [...exported.diagnostics, ...exported.netlistDiagnostics].find(
        ({ severity }) => severity === "error",
      )?.message ?? "The current Cell could not be exported as an RNL drawing.",
    );
  const { request } = exported;
  let ops = request.ops;
  if (!sourceDrawing.packages.some(({ name }) => name === CANVAS_PACKAGE)) {
    const baseline = createRnlExport(source.project, {
      format: dialect,
      rootDocumentId: fileLevel ? documentId : source.project.topDocumentId,
    });
    ops = opsWithSourceSymbols(
      ops,
      baseline.status === "ready" ? baseline.request.ops : [],
      { packages: sourceDrawing.packages, level: sourceLevel },
      fileLevel ? "file" : "subckt:" + writerName,
    );
  }
  const written = await runtime.write({
    write: { ...request, ops },
    svg: false,
    primitives: false,
  });
  const error = written.document.diagnostics.find(
    ({ severity }) => severity === "error",
  );
  if (error) throw new Error(error.message);
  const records = recordsForLevel(written, writerName, fileLevel);
  const updated = await runtime.replaceRecords({
    ...workspace,
    replace_records: { level, records },
  });
  const target = source.inputs.find(({ path }) => path === updated.path);
  if (!target)
    throw new Error("The updated RNL source file was not part of the import.");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let originalText: string;
  try {
    originalText = decoder.decode(target.bytes);
  } catch (cause) {
    throw new Error(
      `RNL source update requires UTF-8 text in ${updated.path}.`,
      {
        cause,
      },
    );
  }
  return {
    entryPath: entry.path,
    path: updated.path,
    level,
    sourceSha256: sha256Hex(originalText),
    text: originalText.startsWith("\uFEFF")
      ? "\uFEFF" + updated.text
      : updated.text,
  };
}
