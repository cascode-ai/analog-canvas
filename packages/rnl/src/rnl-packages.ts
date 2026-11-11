import lock from "./rnl-canvas-package.lock.json";

/**
 * The standard series the adapter writes and maps (16.3): the export's
 * header pins it, and the import maps the standard packages of it only.
 */
export const RNL_STD_VERSION = "0.3";

/**
 * The Analog Canvas package, not standard: Analog Canvas's appearance
 * variants and chopper, and what only Analog Canvas keeps of a drawing.
 * It is published in rich-netlist/rnl-packages, each version locked
 * by its catalog record and hash (`rnl-canvas-package.lock.json`): the
 * editor ships every locked version, the import maps each, and the export
 * writes the newest.
 */
export const CANVAS_PACKAGE = lock.name;
export const CANVAS_PACKAGE_VERSIONS: readonly string[] = lock.versions.map(
  ({ version }) => version,
);
export const CANVAS_PACKAGE_VERSION = CANVAS_PACKAGE_VERSIONS.at(-1)!;
