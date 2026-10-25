import { readFile } from "node:fs/promises";
import { startCore } from "@rich-netlist/runtime";
import { withCanvasPackage } from "./rnl-core";
import {
  canvasPackageFile,
  canvasPackageLock,
  decodeCanvasPackage,
} from "./rnl-canvas-package";

/** @internal The same verified local assets that the editor ships. */
export const canvasPackageTexts = Promise.all(
  canvasPackageLock.versions.map(async ({ version }) => ({
    version,
    text: await decodeCanvasPackage(
      await readFile(
        new URL(`./${canvasPackageFile(version)}`, import.meta.url),
      ),
      version,
    ),
  })),
);

/** @internal Real Node core with the editor's package workspace, shared by contract tests. */
export async function createRnlTestCore() {
  return withCanvasPackage(startCore(), await canvasPackageTexts);
}
