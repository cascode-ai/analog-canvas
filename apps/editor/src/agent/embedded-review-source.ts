import {
  AGENT_FILE_RESOURCE_MAX_FILES,
  AGENT_FILE_RESOURCE_MAX_BYTES,
  localSourceIdentity,
  type EmbeddedReviewSource,
} from "@icm/agent-adapter";
import { deriveStableId, type CircuitProject } from "@icm/model";
import { localSourceReferences, normalizeSourcePath } from "@icm/spice";
export { matchesAgentReviewTarget } from "@icm/agent-adapter";

async function digestBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function reviewRevision(token: string): Promise<string> {
  return digestBytes(new TextEncoder().encode(token));
}

type SourceRecord = CircuitProject["source"]["files"][number];

function originalBytes({
  text,
  encoding,
}: NonNullable<SourceRecord["content"]>) {
  if (encoding === "utf-16-le" || encoding === "utf-16-be") {
    const bytes = new Uint8Array(2 + text.length * 2);
    const view = new DataView(bytes.buffer);
    const littleEndian = encoding === "utf-16-le";
    view.setUint16(0, 0xfeff, littleEndian);
    for (let index = 0; index < text.length; index++)
      view.setUint16(2 + index * 2, text.charCodeAt(index), littleEndian);
    return bytes;
  }
  const encoded = new TextEncoder().encode(text);
  if (encoding === "utf-8") return encoded;
  const bytes = new Uint8Array(3 + encoded.length);
  bytes.set([0xef, 0xbb, 0xbf]);
  bytes.set(encoded, 3);
  return bytes;
}

/** Read only original bytes reachable from the delivery entry, with their hashes verified. */
export async function embeddedReviewBundle(source: CircuitProject["source"]) {
  const entryPath = source.entry;
  if (!entryPath) return;
  const byPath = new Map<string, SourceRecord[]>();
  for (const record of source.files) {
    if (!/^sha256:[a-f0-9]{64}$/u.test(record.hash)) continue;
    const candidates = byPath.get(record.path) ?? [];
    candidates.push(record);
    byPath.set(record.path, candidates);
  }
  const verified = new Map<
    string,
    { path: string; sha256: string; bytes: Uint8Array }
  >();
  let remaining = AGENT_FILE_RESOURCE_MAX_BYTES;
  async function visit(path: string, packageFile: boolean): Promise<boolean> {
    if (verified.has(path)) return true;
    if (verified.size >= AGENT_FILE_RESOURCE_MAX_FILES) return false;
    const records = byPath.get(path);
    const record =
      records?.length === 1
        ? records[0]
        : records?.find((item) => item.id === deriveStableId("source", path));
    const content = record?.originalContent ?? record?.content;
    if (!content || content.text.length > remaining) return false;
    const bytes = originalBytes(content);
    remaining -= bytes.length;
    if (remaining < 0) return false;
    const sha256 = await digestBytes(bytes);
    if (record?.hash !== `sha256:${sha256}`) return false;
    verified.set(path, { path, sha256, bytes });
    const folder = path.slice(0, path.lastIndexOf("/") + 1);
    for (const dependency of localSourceReferences(
      { path, bytes },
      packageFile,
    )) {
      if (/^[\\/]|[:\x00]/u.test(dependency.path)) return false;
      const relative = normalizeSourcePath(folder + dependency.path);
      if (!relative || !(await visit(relative, dependency.packageFile)))
        return false;
    }
    return true;
  }
  try {
    if (!(await visit(entryPath, false))) return;
  } catch {
    return;
  }
  const files = [...verified.values()];
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

/** Original records survive a native Project save, unlike the tab receipt. */
export async function embeddedReviewSource(
  source: CircuitProject["source"],
): Promise<EmbeddedReviewSource | undefined> {
  const bundle = await embeddedReviewBundle(source);
  return (
    bundle && {
      entryPath: bundle.entryPath,
      version: bundle.version,
      files: bundle.files.map(({ path, sha256 }) => ({ path, sha256 })),
    }
  );
}
