import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * The bytes the headless RNL writer needs, from the checkout. The headless
 * bundle replaces this module with the same bytes inline, so an installed
 * bundle carries them itself.
 */
const runtimeRequire = createRequire(import.meta.url);

export async function loadHeadlessRnlCoreWasm(): Promise<Uint8Array> {
  const manifest = runtimeRequire.resolve("@rich-netlist/runtime/package.json");
  return readFileSync(resolve(dirname(manifest), "rnl_runtime_wasm.wasm"));
}

export async function loadHeadlessRnlPackage(
  version: string,
): Promise<Uint8Array> {
  return readFileSync(
    new URL(
      `../features/netlist-export/analog-canvas-extensions-${version}.rnl`,
      import.meta.url,
    ),
  );
}
