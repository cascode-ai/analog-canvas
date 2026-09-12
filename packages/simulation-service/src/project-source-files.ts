import {
  ProjectSimulationFolderSchema,
  type ProjectSimulationFolder,
  type CircuitProject,
} from "@icm/model";
import {
  generateCircuitSource,
  planCircuitSourceEdit,
  type CircuitParameterChange,
} from "@icm/netlist";
import { problem, type Problem } from "./contract.js";
import { planSimulationSourceChanges } from "./source-files.js";
import type {
  SimulationFileOperation,
  SimulationFileResult,
} from "./file-contract.js";
import { sha256 } from "./content-digest.js";

export interface ProjectSourceSnapshot {
  /** The host's Project replacement identity, distinct from the revision. */
  projectSessionId: string;
  structureRevision: number;
  folder: ProjectSimulationFolder;
  /** Omitted only by text-only hosts; generated Circuit access requires the authoritative Project. */
  project?: CircuitProject;
}

/** Adapter to existing Project history/transactions; it does not own a store. */
export interface ProjectSimulationFileHost {
  read(folderId: string): ProjectSourceSnapshot | undefined;
  /** Must atomically check the session and expected revision before upsert. */
  commit(
    expected: Pick<
      ProjectSourceSnapshot,
      "projectSessionId" | "structureRevision"
    >,
    folder: ProjectSimulationFolder,
    parameters?: CircuitParameterChange[],
  ):
    | { ok: true; snapshot: ProjectSourceSnapshot }
    | { ok: false; error: Problem };
}

type FileReply = SimulationFileResult | { ok: false; error: Problem };
type OwnedOperation = Extract<
  SimulationFileOperation,
  { action: "list" | "read" | "update" }
>;

export function listProjectSource(
  snapshot: ProjectSourceSnapshot,
): SimulationFileResult {
  const { folder, structureRevision } = snapshot;
  const input = folder.input;
  return {
    ok: true,
    source: {
      owner: { kind: "project-folder", folderId: folder.id },
      revision: structureRevision,
      entry: input.entry,
      configPath: input.configPath,
      ...(input.drafts?.length ? { drafts: input.drafts } : {}),
      files: [
        ...input.files.map((file) => ({
          path: file.path,
          kind: "authored" as const,
          byteLength: new TextEncoder().encode(file.text).byteLength,
        })),
        ...input.circuitBindings.map((b) => ({
          path: b.path,
          kind: "generated" as const,
        })),
        ...input.dependencies.map((d) => ({
          path: d.mountPath,
          kind: "dependency" as const,
        })),
      ],
    },
  };
}

export async function handleProjectSourceFiles(
  host: ProjectSimulationFileHost,
  op: OwnedOperation,
  active: () => boolean,
): Promise<FileReply> {
  if (!op.owner || op.owner.kind !== "project-folder")
    return problem(
      "SIMULATION_FILE_INVALID",
      "Expected a Project folder owner",
      "input",
    );
  const folderId = op.owner.folderId;
  const before = host.read(folderId);
  if (!before || !active())
    return problem(
      "SIMULATION_FOLDER_UNAVAILABLE",
      "Read the current Project and select an existing folder",
      "input",
    );
  const current = () => host.read(folderId);
  const conflict = () => {
    const result = problem(
      "PROJECT_REVISION_CONFLICT",
      "Reread the Project files; no changes were applied",
      "input",
    );
    return {
      ...result,
      error: { ...result.error, currentRevision: current()?.structureRevision },
    };
  };
  const unchanged = () => {
    const now = current();
    return (
      active() &&
      now?.projectSessionId === before.projectSessionId &&
      now.structureRevision === before.structureRevision &&
      (!before.project || now.project === before.project)
    );
  };
  if (op.action === "list") return listProjectSource(before);
  if (op.action === "read") {
    let file = before.folder.input.files.find((f) => f.path === op.path);
    let editableParameters;
    let instances;
    const binding = before.folder.input.circuitBindings.find(
      (b) => b.path === op.path,
    );
    if (!file && binding && before.project) {
      const result = generateCircuitSource(before.project, binding);
      if (!result.ok)
        return problem(
          "SIMULATION_CIRCUIT_UNAVAILABLE",
          result.diagnostics[0]?.message ??
            "Resolve the Circuit diagnostics before generating its source",
          "input",
        );
      file = { path: binding.path, text: result.source.text };
      instances = result.source.instances;
      editableParameters = result.source.parameters.map((p) => ({
        from: p.startOffset,
        to: p.endOffset,
        label: p.descriptor.label,
        documentId: p.documentId,
        instanceId: p.instanceId,
        parameter: p.parameter,
      }));
    }
    if (!file)
      return problem(
        "SIMULATION_FILE_NOT_FOUND",
        "No available authored or generated Circuit file at this path",
        "input",
      );
    if (op.offset > file.text.length)
      return problem(
        "SIMULATION_TEXT_RANGE_INVALID",
        "Offset exceeds file length",
        "input",
      );
    const textDigest = await sha256(file.text);
    if (!unchanged()) return conflict();
    const end = Math.min(file.text.length, op.offset + op.maxChars);
    return {
      ok: true,
      owner: op.owner,
      revision: before.structureRevision,
      path: file.path,
      textDigest,
      text: file.text.slice(op.offset, end),
      offset: op.offset,
      nextOffset: end < file.text.length ? end : null,
      ...(editableParameters ? { editableParameters } : {}),
      ...(instances ? { instances } : {}),
    };
  }
  if (op.expectedRevision !== before.structureRevision) return conflict();
  const input = before.folder.input;
  const planned = await planSimulationSourceChanges(
    input.files,
    {
      writes: op.writes,
      removes: op.removes,
      patches: op.patches,
    },
    [
      ...input.circuitBindings.map((b) => b.path),
      ...input.dependencies.map((d) => d.mountPath),
    ],
  );
  if (!planned.ok) return planned;
  const parameters = new Map<string, CircuitParameterChange>();
  const editedPaths = new Set<string>();
  for (const edit of op.circuitEdits) {
    if (editedPaths.has(edit.path))
      return problem(
        "SIMULATION_PARAMETER_CONFLICT",
        "Supply each generated Circuit path only once",
        "input",
      );
    editedPaths.add(edit.path);
    const binding = input.circuitBindings.find((b) => b.path === edit.path);
    if (!binding || !before.project)
      return problem(
        "SIMULATION_CIRCUIT_UNAVAILABLE",
        "This host cannot resolve the requested Circuit binding",
        "input",
      );
    const generated = generateCircuitSource(before.project, binding);
    if (!generated.ok)
      return problem(
        "SIMULATION_CIRCUIT_UNAVAILABLE",
        generated.diagnostics[0]?.message ?? "Circuit source is unavailable",
        "input",
      );
    if ((await sha256(generated.source.text)) !== edit.textDigest)
      return conflict();
    const mapped = planCircuitSourceEdit(generated.source, edit.text);
    if (!mapped.ok) return problem(mapped.code, mapped.message, "input");
    for (const change of mapped.changes) {
      const key = JSON.stringify([
        change.documentId,
        change.instanceId,
        change.parameter,
      ]);
      const existing = parameters.get(key);
      if (
        existing &&
        (existing.value !== change.value || existing.unset !== change.unset)
      )
        return problem(
          "SIMULATION_PARAMETER_CONFLICT",
          "Repeated Circuit appearances must assign the same parameter value",
          "input",
        );
      parameters.set(key, change);
    }
  }
  if (!unchanged()) return conflict();
  const committedPaths = new Set([
    ...op.writes.map((file) => file.path),
    ...op.removes,
    ...op.patches.map((patch) => patch.path),
    ...editedPaths,
  ]);
  const remainingDrafts =
    op.drafts ??
    input.drafts?.filter((draft) => !committedPaths.has(draft.path));
  const next = ProjectSimulationFolderSchema.safeParse({
    ...before.folder,
    input: {
      ...input,
      files: planned.files,
      entry: op.entry ?? input.entry,
      configPath: op.configPath ?? input.configPath,
      ...(remainingDrafts ? { drafts: remainingDrafts } : {}),
    },
  });
  if (!next.success)
    return problem(
      "SIMULATION_FILE_INVALID",
      next.error.issues[0]?.message ?? "Invalid file ownership",
      "input",
    );
  // Do not parse SPICE/JSON here: broken text and missing references are saveable.
  if (
    !parameters.size &&
    JSON.stringify(next.data) === JSON.stringify(before.folder)
  )
    return listProjectSource(before);
  const committed = host.commit(before, next.data, [...parameters.values()]);
  return committed.ok ? listProjectSource(committed.snapshot) : committed;
}
