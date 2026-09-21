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
  replacements: z
    .array(
      z.strictObject({
        path: SimulationInputPathSchema,
        textDigest: z.string().regex(/^[a-f0-9]{64}$/u),
        oldText: z.string().min(1),
        newText: z.string(),
      }),
    )
    .max(4096)
    .optional(),
  writes: z.array(SimulationRawFileSchema).max(4096).default([]),
  removes: z.array(SimulationInputPathSchema).max(4096).default([]),
  patches: z.array(SimulationTextPatchSchema).max(4096).default([]),
});
export type SimulationSourceChanges = z.infer<
  typeof SimulationSourceChangesSchema
>;

export const SourceUpdateReceiptSchema = z.strictObject({
  changed: z.boolean(),
  mappedCircuitPaths: z.array(SimulationInputPathSchema).optional(),
  files: z.array(
    z.strictObject({
      path: SimulationInputPathSchema,
      action: z.enum(["created", "updated", "removed"]),
      textDigest: z.string().optional(),
      byteLength: z.number().int().nonnegative().optional(),
    }),
  ),
});
export async function sourceUpdateReceipt(
  before: readonly SimulationRawFile[],
  after: readonly SimulationRawFile[],
): Promise<z.infer<typeof SourceUpdateReceiptSchema>> {
  const old = new Map(before.map((file) => [file.path, file.text]));
  const next = new Map(after.map((file) => [file.path, file.text]));
  const files: z.infer<typeof SourceUpdateReceiptSchema>["files"] = [];
  for (const [path, text] of next) {
    if (old.get(path) === text) continue;
    files.push({
      path,
      action: old.has(path) ? "updated" : "created",
      textDigest: await sha256(text),
      byteLength: new TextEncoder().encode(text).byteLength,
    });
  }
  for (const path of old.keys())
    if (!next.has(path)) files.push({ path, action: "removed" });
  return { changed: files.length > 0, files };
}

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
  const expanded = [...patches];
  for (const [operationIndex, edit] of (
    parsed.data.replacements ?? []
  ).entries()) {
    const text = current.find((file) => file.path === edit.path)?.text;
    const fail = (code: string, message: string, matchCount?: number) => ({
      ok: false as const,
      error: {
        ...problem(code, message, "input").error,
        fileEdit: {
          applied: false as const,
          path: edit.path,
          operation: "replace" as const,
          operationIndex,
          ...(matchCount === undefined ? {} : { matchCount }),
        },
      },
    });
    if (protectedPaths.includes(edit.path))
      return fail(
        "SIMULATION_GENERATED_FILE_READ_ONLY",
        "Use the file's advertised editing mode",
      );
    if (text === undefined)
      return fail("SIMULATION_FILE_NOT_FOUND", "Authored file not found");
    if ((await sha256(text)) !== edit.textDigest)
      return fail(
        "SIMULATION_TEXT_REVISION_CONFLICT",
        "File text changed; reread this file",
      );
    let matchCount = 0,
      startOffset = -1,
      offset = 0;
    while (offset <= text.length) {
      const found = text.indexOf(edit.oldText, offset);
      if (found < 0) break;
      startOffset = found;
      matchCount++;
      offset = found + 1;
    }
    if (matchCount !== 1)
      return fail(
        matchCount
          ? "SIMULATION_TEXT_MATCH_AMBIGUOUS"
          : "SIMULATION_TEXT_MATCH_NOT_FOUND",
        "Exact replacement requires one match in the original file",
        matchCount,
      );
    expanded.push({
      path: edit.path,
      textDigest: edit.textDigest,
      startOffset,
      endOffset: startOffset + edit.oldText.length,
      text: edit.newText,
    });
  }
  const locked = new Set(protectedPaths);
  const fileProblem = (code: string, message: string, path: string) => ({
    ok: false as const,
    error: {
      ...problem(code, message, "input").error,
      fileEdit: { applied: false as const, path },
    },
  });
  const full = new Set<string>();
  for (const path of [...removes, ...writes.map((file) => file.path)]) {
    if (full.has(path))
      return fileProblem(
        "SIMULATION_FILE_OVERLAPPING_EDIT",
        `Duplicate whole-file edit: ${path}`,
        path,
      );
    full.add(path);
  }
  for (const path of [...full, ...expanded.map((patch) => patch.path)]) {
    if (locked.has(path))
      return fileProblem(
        "SIMULATION_GENERATED_FILE_READ_ONLY",
        `Use mapped parameter edits or Canvas edits for ${path}`,
        path,
      );
  }
  const grouped = new Map<string, typeof patches>();
  for (const patch of expanded) {
    if (full.has(patch.path))
      return fileProblem(
        "SIMULATION_FILE_OVERLAPPING_EDIT",
        `Cannot patch and replace/remove ${patch.path} together`,
        patch.path,
      );
    const group = grouped.get(patch.path) ?? [];
    group.push(patch);
    grouped.set(patch.path, group);
  }
  const files = new Map(current.map((file) => [file.path, file.text]));
  for (const [path, group] of grouped) {
    const text = files.get(path);
    if (text === undefined)
      return fileProblem(
        "SIMULATION_FILE_NOT_FOUND",
        `No authored file ${path}`,
        path,
      );
    const digest = await sha256(text);
    const ordered = [...group].sort(
      (a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset,
    );
    let end = -1;
    let previousStart = -1;
    for (const patch of ordered) {
      if (patch.textDigest !== digest)
        return fileProblem(
          "SIMULATION_TEXT_REVISION_CONFLICT",
          `Reread ${path}; its text has changed`,
          path,
        );
      if (
        patch.endOffset < patch.startOffset ||
        patch.endOffset > text.length ||
        splitsSurrogate(text, patch.startOffset) ||
        splitsSurrogate(text, patch.endOffset)
      )
        return fileProblem(
          "SIMULATION_TEXT_RANGE_INVALID",
          `Invalid UTF-16 range in ${path}`,
          path,
        );
      if (patch.startOffset < end || patch.startOffset === previousStart)
        return fileProblem(
          "SIMULATION_FILE_OVERLAPPING_EDIT",
          `Overlapping text patches in ${path}`,
          path,
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
