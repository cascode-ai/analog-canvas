import lock from "./rnl-canvas-package.lock.json";

/**
 * The RNL language the adapter writes and reads (16.1). A file of any other
 * version is refused on import; `rnl upgrade` raises it.
 */
export const RNL_LANGUAGE_VERSION = "0.4";

/**
 * The standard series the adapter writes and maps (16.3): the export's
 * header pins each package of it it uses, and the import maps the standard
 * packages of it only.
 */
export const RNL_STD_VERSION = "0.4";

/**
 * The Analog Canvas package, not standard: Analog Canvas's appearance
 * variants, and what only Analog Canvas keeps of a drawing. It is published
 * in rich-netlist/rnl-packages, locked by its catalog record and hash
 * (`rnl-canvas-package.lock.json`): the editor ships, reads and writes that
 * one version, a package of the language it writes (decision 0017).
 */
export const CANVAS_PACKAGE = lock.name;
export const CANVAS_PACKAGE_VERSION = lock.versions.at(-1)!.version;
