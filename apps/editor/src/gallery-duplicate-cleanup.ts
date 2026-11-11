import type { GalleryFeedEntry } from "./gallery-client";

type Reference = { id: string; previewRevision: string };
type CleanupCommand = {
  key: string;
  body: { keep: Reference; remove: Reference[] };
  rejected?: boolean;
};
const pending = new Map<string, CleanupCommand>();
const prefix = "canvas-duplicate-cleanup:";

function rememberedCommand(keepId: string): CleanupCommand | undefined {
  let command = pending.get(keepId);
  if (!command) {
    try {
      const stored = JSON.parse(
        globalThis.sessionStorage?.getItem(prefix + keepId) ?? "null",
      ) as CleanupCommand | null;
      const validReference = (value: Reference) =>
        value &&
        typeof value.id === "string" &&
        typeof value.previewRevision === "string";
      if (
        stored &&
        typeof stored.key === "string" &&
        /^[A-Za-z0-9_-]{1,128}$/.test(stored.key) &&
        validReference(stored.body?.keep) &&
        stored.body.keep.id === keepId &&
        Array.isArray(stored.body.remove) &&
        stored.body.remove.length > 0 &&
        stored.body.remove.length <= 49 &&
        stored.body.remove.every(validReference)
      )
        command = stored;
    } catch {
      /* Memory retains the complete intent when storage is unavailable. */
    }
  }
  if (command) pending.set(keepId, command);
  return command;
}

/** A rescan must keep the pending intent's chosen survivor, not pick a new default. */
export function pendingDuplicateSurvivor(
  group: GalleryFeedEntry[],
): string | undefined {
  const ids = new Set(group.map((entry) => entry.id));
  return group.find((entry) =>
    rememberedCommand(entry.id)?.body.remove.some((item) => ids.has(item.id)),
  )?.id;
}

function commandFor(keep: Reference, remove: Reference[]): CleanupCommand {
  let command = rememberedCommand(keep.id);
  const body = { keep, remove };
  // A changed request after a definitive conflict is a new intent. Shrinking
  // rows after an uncertain/partial result must never take this branch.
  if (
    command?.rejected &&
    JSON.stringify(command.body) !== JSON.stringify(body)
  )
    command = undefined;
  command ??= { key: crypto.randomUUID(), body };
  command.rejected = false;
  pending.set(keep.id, command);
  persistCommand(keep.id, command);
  return command;
}

function persistCommand(keepId: string, command: CleanupCommand) {
  try {
    globalThis.sessionStorage?.setItem(
      prefix + keepId,
      JSON.stringify(command),
    );
  } catch {
    /* Only IDs and revisions are persisted, never circuit content. */
  }
}

function forgetCommand(keepId: string, command: CleanupCommand) {
  if (pending.get(keepId)?.key !== command.key) return;
  pending.delete(keepId);
  try {
    globalThis.sessionStorage?.removeItem(prefix + keepId);
  } catch {
    /* Storage can be disabled. */
  }
}

export class DuplicateCleanupIncomplete extends Error {
  constructor(readonly recycled: string[]) {
    super(
      `${recycled.length} circuits were removed; the remaining removals could not be confirmed. Check again before retrying.`,
    );
  }
}

/** Keep the oldest publication by default, with a stable tie-break. */
export function defaultDuplicateSurvivor(group: GalleryFeedEntry[]): string {
  return [...group].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )[0]!.id;
}

export async function recycleDuplicateGroup(
  group: GalleryFeedEntry[],
  keepId: string,
  fetchLike: typeof fetch = fetch,
): Promise<string[]> {
  const keep = group.find((entry) => entry.id === keepId);
  if (!keep) throw new Error("Choose a circuit to keep.");
  const reference = (entry: GalleryFeedEntry) => ({
    id: entry.id,
    previewRevision: entry.previewRevision || "legacy",
  });
  // Displayed rows shrink after partial success; the original writer receipts
  // still belong to the complete request and must retain its body and identity.
  const command = commandFor(
    reference(keep),
    group.filter((entry) => entry.id !== keepId).map(reference),
  );
  let response: Response;
  try {
    response = await fetchLike("/api/gallery/duplicates/recycle", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "idempotency-key": command.key,
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify(command.body),
    });
  } catch {
    throw new Error(
      "Connection interrupted. Check again to see what was removed.",
    );
  }
  if (response.status === 409) {
    command.rejected = true;
    persistCommand(keepId, command);
    throw new Error(
      "These circuits changed or no longer match. Check duplicates again.",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Sign in as an administrator to remove duplicates.");
  }
  if (!response.ok)
    throw new Error(
      "Could not remove this group. Check again before retrying.",
    );
  const payload = await response.json().catch(() => null);
  const expected = group
    .filter((entry) => entry.id !== keepId)
    .map((entry) => entry.id);
  const original = command.body.remove.map((entry) => entry.id);
  if (
    payload?.kept !== keepId ||
    !Array.isArray(payload.recycled) ||
    new Set(payload.recycled).size !== payload.recycled.length ||
    !payload.recycled.every(
      (id: unknown) => typeof id === "string" && original.includes(id),
    )
  ) {
    throw new Error("Could not confirm the result. Check duplicates again.");
  }
  const confirmed = expected.filter((id) => payload.recycled.includes(id));
  if (response.status === 207) throw new DuplicateCleanupIncomplete(confirmed);
  if (payload.recycled.length !== original.length)
    throw new Error("Could not confirm the result. Check duplicates again.");
  forgetCommand(keepId, command);
  if (confirmed.length !== expected.length)
    throw new DuplicateCleanupIncomplete(confirmed);
  return expected;
}
