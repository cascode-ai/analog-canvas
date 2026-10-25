import lock from "./rnl-canvas-package.lock.json" with { type: "json" };

/** Every version the editor ships, so a file written with any of them reads. */
export const canvasPackageLock = lock;

/** The version the editor writes: the newest it ships. */
export const canvasPackageVersion = lock.versions.at(-1)!.version;

/** The file each version ships as, beside this module. */
export const canvasPackageFile = (version: string) =>
  `${lock.name}-${version}.rnl`;

/** Verify original bytes before decoding, in the build, Node tests and editor. */
export async function decodeCanvasPackage(
  bytes: Uint8Array,
  version: string,
): Promise<string> {
  const pinned = lock.versions.find((item) => item.version === version);
  if (!pinned) throw new Error(`Canvas package ${version} is not locked`);
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== pinned.sha256)
    throw new Error(
      `Canvas package SHA-256 mismatch: expected ${pinned.sha256} for ${version}, received ${hash}`,
    );
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
