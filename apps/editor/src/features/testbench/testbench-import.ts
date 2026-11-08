import {
  isSimulationInputPath,
  type CircuitProject,
  type ProjectSimulationFolder,
} from "@icm/model";
import { AGENT_FILE_RESOURCE_MAX_BYTES } from "@icm/agent-adapter";
import { createSimulationStarter, newFolderCellRole } from "@icm/netlist";

/** One chosen file, read as text, at its path relative to what was picked. */
export interface PickedFile {
  path: string;
  text: string;
}

export type ImportRowStatus =
  "new" | "replace" | "unchanged" | "generated" | "unsafe" | "binary";

export interface ImportRow {
  path: string;
  status: ImportRowStatus;
  text: string;
}

/**
 * The relative path of a picked file: below the picked folder when a folder
 * was picked (its top directory dropped), else its name. Backslashes from
 * Windows pickers become slashes.
 */
export function pickedPath(file: {
  name: string;
  webkitRelativePath?: string;
}): string {
  const relative = file.webkitRelativePath?.replaceAll("\\", "/") ?? "";
  const parts = relative.split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join("/") : file.name;
}

/**
 * What importing these files into a Testbench would do, file by file (#2110).
 * A Canvas-written path (the Cell's generated netlist) is never replaced by a
 * copy: the drawing stays its only authority. Unsafe paths and binary files
 * are refused; every other file is new, replaces different text or is
 * unchanged.
 */
export function planTestbenchImport(
  folder: ProjectSimulationFolder | null,
  picked: readonly PickedFile[],
  generatedPaths: readonly string[] = ["circuit.spice"],
): ImportRow[] {
  const generated = new Set([
    ...generatedPaths,
    ...(folder?.input.circuitBindings.map((binding) => binding.path) ?? []),
    ...(folder?.input.dependencies.map((dependency) => dependency.mountPath) ??
      []),
  ]);
  const seen = new Set<string>();
  return picked.flatMap((file) => {
    if (seen.has(file.path)) return [];
    seen.add(file.path);
    const existing = folder?.input.files.find(
      (item) => item.path === file.path,
    );
    const status: ImportRowStatus = !isSimulationInputPath(file.path)
      ? "unsafe"
      : file.text.includes("\u0000")
        ? "binary"
        : generated.has(file.path)
          ? "generated"
          : !existing
            ? "new"
            : existing.text === file.text
              ? "unchanged"
              : "replace";
    return [{ path: file.path, status, text: file.text }];
  });
}

/** The file a simulator is pointed at: the one calling the DUT, else a deck. */
export function guessTestbenchEntry(rows: readonly ImportRow[]): string | null {
  const usable = rows.filter(
    (row) => row.status === "new" || row.status === "replace",
  );
  const deck = /\.(?:sp|spi|spice|cir|net|scs|ckt)$/iu;
  return (
    usable.find((row) => /^\s*x\S*\s/imu.test(row.text) && deck.test(row.path))
      ?.path ??
    usable.find((row) => /^\s*\.end\b/imu.test(row.text))?.path ??
    usable.find((row) => deck.test(row.path))?.path ??
    usable[0]?.path ??
    null
  );
}

/**
 * The folder after the import: the chosen rows written over the existing
 * folder, or a new Testbench for the Cell holding them, its entry the one
 * named. Returns a reason instead when nothing can be written.
 */
export function applyTestbenchImport(
  project: CircuitProject,
  target: { cellId: string; folder: ProjectSimulationFolder | null },
  rows: readonly ImportRow[],
  chosen: ReadonlySet<string>,
  entry: string | null,
  name: string,
):
  | { ok: true; folder: ProjectSimulationFolder }
  | { ok: false; message: string } {
  const writes = rows.filter(
    (row) =>
      chosen.has(row.path) &&
      (row.status === "new" || row.status === "replace"),
  );
  if (!writes.length)
    return { ok: false, message: "Choose at least one new or changed file." };
  const bytes = writes.reduce(
    (total, row) => total + new TextEncoder().encode(row.text).byteLength,
    0,
  );
  if (bytes > AGENT_FILE_RESOURCE_MAX_BYTES)
    return {
      ok: false,
      message: "These files are larger than 10 MB together; import fewer.",
    };
  let base = target.folder;
  if (!base) {
    const starter = createSimulationStarter(project, {
      id: crypto.randomUUID(),
      name,
      documentId: target.cellId,
      mode:
        newFolderCellRole(project, target.cellId) === "dut" ? "dut" : "circuit",
      template: "testbench",
    });
    if (!starter.ok) return { ok: false, message: starter.message };
    // The imported files are the Testbench; the starter only lends its
    // binding to the Cell.
    base = {
      ...starter.folder,
      input: { ...starter.folder.input, files: [] },
    };
  }
  const written = new Map(base.input.files.map((file) => [file.path, file]));
  for (const row of writes)
    written.set(row.path, { path: row.path, text: row.text });
  const nextEntry =
    entry && written.has(entry)
      ? entry
      : written.has(base.input.entry)
        ? base.input.entry
        : (writes[0]?.path ?? base.input.entry);
  return {
    ok: true,
    folder: {
      ...base,
      input: {
        ...base.input,
        entry: nextEntry,
        files: [...written.values()],
      },
    },
  };
}
