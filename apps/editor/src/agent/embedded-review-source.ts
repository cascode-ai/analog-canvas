import {
  AGENT_FILE_RESOURCE_MAX_FILES,
  localSourceIdentity,
  type EmbeddedReviewSource,
} from "@icm/agent-adapter";
import type { CircuitProject } from "@icm/model";

export async function reviewRevision(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Original records survive a native Project save, unlike the tab receipt. */
export async function embeddedReviewSource(
  source: CircuitProject["source"],
): Promise<EmbeddedReviewSource | undefined> {
  const entryPath = source.entry;
  if (!entryPath) return;
  const files = source.files.flatMap(({ path, hash }) =>
    /^sha256:[a-f0-9]{64}$/u.test(hash)
      ? [{ path, sha256: hash.slice(7) }]
      : [],
  );
  if (
    files.length > AGENT_FILE_RESOURCE_MAX_FILES ||
    new Set(files.map(({ path }) => path)).size !== files.length ||
    !files.some(({ path }) => path === entryPath)
  )
    return;
  return {
    entryPath,
    files,
    version: await reviewRevision(
      localSourceIdentity(
        entryPath,
        files.map(({ path, sha256 }) => ({ name: path, sha256 })),
      ),
    ),
  };
}
