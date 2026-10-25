import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import {
  canvasPackageFile,
  canvasPackageLock,
  decodeCanvasPackage,
} from "../src/features/netlist-export/rnl-canvas-package";

/** Both compositions verify the vendored bytes before Vite copies the assets. */
export function lockedCanvasPackage(): Plugin {
  let directory = "";
  return {
    name: "locked-canvas-package",
    configResolved(config) {
      directory = resolve(config.root, "src/features/netlist-export");
    },
    async buildStart() {
      for (const { version } of canvasPackageLock.versions) {
        const path = resolve(directory, canvasPackageFile(version));
        this.addWatchFile(path);
        await decodeCanvasPackage(await readFile(path), version);
      }
    },
  };
}
