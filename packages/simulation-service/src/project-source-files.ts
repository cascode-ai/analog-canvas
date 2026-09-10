import {
  ProjectSourceSimulationSetupSchema,
  type ProjectSourceSimulationSetup,
} from "@icm/model";
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
  setup: ProjectSourceSimulationSetup;
}

/** Adapter to existing Project history/transactions; it does not own a store. */
export interface ProjectSimulationFileHost {
  read(setupId: string): ProjectSourceSnapshot | undefined;
  /** Must atomically check the session and expected revision before upsert. */
  commit(
    expected: Pick<
      ProjectSourceSnapshot,
      "projectSessionId" | "structureRevision"
    >,
    setup: ProjectSourceSimulationSetup,
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
  const { setup, structureRevision } = snapshot;
  const input = setup.input;
  return {
    ok: true,
    source: {
      owner: { kind: "project-setup", setupId: setup.id },
      revision: structureRevision,
      entry: input.entry,
      configPath: input.configPath,
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
  if (!op.owner || op.owner.kind !== "project-setup")
    return problem(
      "SIMULATION_FILE_INVALID",
      "Expected a Project setup owner",
      "input",
    );
  const setupId = op.owner.setupId;
  const before = host.read(setupId);
  if (!before || !active())
    return problem(
      "SIMULATION_SETUP_UNAVAILABLE",
      "Read the current Project and select an existing setup",
      "input",
    );
  const current = () => host.read(setupId);
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
      now.structureRevision === before.structureRevision
    );
  };
  if (op.action === "list") return listProjectSource(before);
  if (op.action === "read") {
    const file = before.setup.input.files.find((f) => f.path === op.path);
    if (!file)
      return problem(
        "SIMULATION_FILE_NOT_FOUND",
        "Select authored text; generated circuit text uses the mapped-parameter resource",
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
    };
  }
  if (op.expectedRevision !== before.structureRevision) return conflict();
  const input = before.setup.input;
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
  if (!unchanged()) return conflict();
  const next = ProjectSourceSimulationSetupSchema.safeParse({
    ...before.setup,
    input: {
      ...input,
      files: planned.files,
      entry: op.entry ?? input.entry,
      configPath: op.configPath ?? input.configPath,
    },
  });
  if (!next.success)
    return problem(
      "SIMULATION_FILE_INVALID",
      next.error.issues[0]?.message ?? "Invalid file ownership",
      "input",
    );
  // Do not parse SPICE/JSON here: broken text and missing references are saveable.
  if (JSON.stringify(next.data) === JSON.stringify(before.setup))
    return listProjectSource(before);
  const committed = host.commit(before, next.data);
  return committed.ok ? listProjectSource(committed.snapshot) : committed;
}
