import { z } from "zod";
import {
  SimulationInputPathSchema,
  SimulationRawFileSchema,
  type SimulationRawFile,
} from "@icm/model";
import { problem, type Problem } from "./contract.js";
import { sha256 } from "./content-digest.js";

export const SimulationTextPatchSchema = z.strictObject({
  path: SimulationInputPathSchema,
  textDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  text: z.string(),
});
export const SimulationSourceChangesSchema = z.strictObject({
  writes: z.array(SimulationRawFileSchema).max(4096).default([]),
  removes: z.array(SimulationInputPathSchema).max(4096).default([]),
  patches: z.array(SimulationTextPatchSchema).max(4096).default([]),
});
export type SimulationSourceChanges = z.infer<
  typeof SimulationSourceChangesSchema
>;

/** Shared atomic text planner. Ownership revision and commit belong to its caller. */
export async function planSimulationSourceChanges(
  current: readonly SimulationRawFile[],
  changes: SimulationSourceChanges,
  protectedPaths: readonly string[] = [],
): Promise<
  { ok: true; files: SimulationRawFile[] } | { ok: false; error: Problem }
> {
  const parsed = SimulationSourceChangesSchema.safeParse(changes);
  if (!parsed.success)
    return problem(
      "SIMULATION_FILE_INVALID",
      parsed.error.issues[0]!.message,
      "input",
    );
  const { writes, removes, patches } = parsed.data;
  const locked = new Set(protectedPaths);
  const full = new Set<string>();
  for (const path of [...removes, ...writes.map((file) => file.path)]) {
    if (full.has(path))
      return problem(
        "SIMULATION_FILE_OVERLAPPING_EDIT",
        `Duplicate whole-file edit: ${path}`,
        "input",
      );
    full.add(path);
  }
  for (const path of [...full, ...patches.map((patch) => patch.path)]) {
    if (locked.has(path))
      return problem(
        "SIMULATION_GENERATED_FILE_READ_ONLY",
        `Use mapped parameter edits or Canvas edits for ${path}`,
        "input",
      );
  }
  const grouped = new Map<string, typeof patches>();
  for (const patch of patches) {
    if (full.has(patch.path))
      return problem(
        "SIMULATION_FILE_OVERLAPPING_EDIT",
        `Cannot patch and replace/remove ${patch.path} together`,
        "input",
      );
    const group = grouped.get(patch.path) ?? [];
    group.push(patch);
    grouped.set(patch.path, group);
  }
  const files = new Map(current.map((file) => [file.path, file.text]));
  for (const [path, group] of grouped) {
    const text = files.get(path);
    if (text === undefined)
      return problem(
        "SIMULATION_FILE_NOT_FOUND",
        `No authored file ${path}`,
        "input",
      );
    const digest = await sha256(text);
    const ordered = [...group].sort(
      (a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset,
    );
    let end = -1;
    let previousStart = -1;
    for (const patch of ordered) {
      if (patch.textDigest !== digest)
        return problem(
          "SIMULATION_TEXT_REVISION_CONFLICT",
          `Reread ${path}; its text has changed`,
          "input",
        );
      if (
        patch.endOffset < patch.startOffset ||
        patch.endOffset > text.length ||
        splitsSurrogate(text, patch.startOffset) ||
        splitsSurrogate(text, patch.endOffset)
      )
        return problem(
          "SIMULATION_TEXT_RANGE_INVALID",
          `Invalid UTF-16 range in ${path}`,
          "input",
        );
      if (patch.startOffset < end || patch.startOffset === previousStart)
        return problem(
          "SIMULATION_FILE_OVERLAPPING_EDIT",
          `Overlapping text patches in ${path}`,
          "input",
        );
      end = patch.endOffset;
      previousStart = patch.startOffset;
    }
    let updated = text;
    for (const patch of ordered.reverse())
      updated =
        updated.slice(0, patch.startOffset) +
        patch.text +
        updated.slice(patch.endOffset);
    files.set(path, updated);
  }
  for (const path of removes) files.delete(path);
  for (const { path, text } of writes) files.set(path, text);
  return {
    ok: true,
    files: [...files]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, text]) => ({ path, text })),
  };
}

function splitsSurrogate(text: string, offset: number): boolean {
  const left = text.charCodeAt(offset - 1);
  const right = text.charCodeAt(offset);
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
}
