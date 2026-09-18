import type { GalleryFeedEntry } from "./gallery-client";

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
  let response: Response;
  try {
    response = await fetchLike("/api/gallery/duplicates/recycle", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        keep: reference(keep),
        remove: group.filter((entry) => entry.id !== keepId).map(reference),
      }),
    });
  } catch {
    throw new Error(
      "Connection interrupted. Check again to see what was removed.",
    );
  }
  if (response.status === 409) {
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
  if (
    payload?.kept !== keepId ||
    !Array.isArray(payload.recycled) ||
    payload.recycled.length !== expected.length ||
    !expected.every((id) => payload.recycled.includes(id))
  ) {
    throw new Error("Could not confirm the result. Check duplicates again.");
  }
  return expected;
}
