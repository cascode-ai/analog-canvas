import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canvasPackageFile,
  canvasPackageLock as lock,
  decodeCanvasPackage,
} from "../apps/editor/src/features/netlist-export/rnl-canvas-package.ts";

const asset = (version) =>
  new URL(
    `../apps/editor/src/features/netlist-export/${canvasPackageFile(version)}`,
    import.meta.url,
  );

/**
 * Download each locked version, only from the catalog record pinned by
 * name, version, URL and raw hash.
 */
export async function downloadCanvasPackages(request = fetch) {
  const response = await request(lock.catalogUrl);
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
  const catalog = await response.json();
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.packages))
    throw new Error("Unsupported package catalog");
  const packages = new Map();
  for (const pinned of lock.versions) {
    const record = catalog.packages.find(
      (item) => item?.name === lock.name && item.version === pinned.version,
    );
    if (
      !record ||
      record.sha256 !== pinned.sha256 ||
      typeof record.url !== "string" ||
      new URL(record.url, lock.catalogUrl).href !== pinned.url
    )
      throw new Error(
        `Canvas package lock differs from catalog for ${pinned.version}`,
      );
  }
  for (const pinned of lock.versions) {
    const download = await request(pinned.url);
    if (!download.ok) throw new Error(`Canvas package HTTP ${download.status}`);
    const bytes = new Uint8Array(await download.arrayBuffer());
    await decodeCanvasPackage(bytes, pinned.version);
    packages.set(pinned.version, bytes);
  }
  return packages;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.includes("--fetch")) {
      for (const [version, bytes] of await downloadCanvasPackages())
        await writeFile(asset(version), bytes);
    } else {
      for (const { version } of lock.versions)
        await decodeCanvasPackage(await readFile(asset(version)), version);
    }
    for (const { version, sha256 } of lock.versions)
      console.log(`Verified ${lock.name} ${version}: SHA-256 ${sha256}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
