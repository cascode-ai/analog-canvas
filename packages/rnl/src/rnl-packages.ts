import lock from "./rnl-canvas-package.lock.json";
import line from "./rnl-version-line.json";

/**
 * The RNL language the adapter writes and reads (16.1), from the version
 * line (`rnl-version-line.json`) that also names the runtime and the tools it
 * needs. A file of any other version comes in without its drawing; `rnl
 * upgrade` raises it.
 */
export const RNL_LANGUAGE_VERSION = line.language;

/**
 * The standard series the adapter writes and maps (16.3): the export's
 * header pins each package of it it uses, and the import maps the standard
 * packages of it only.
 */
export const RNL_STD_VERSION = line.standardSeries;

/**
 * The rnl release whose `rnl upgrade` raises a file of the language before to
 * the one the adapter writes: the last of its line, since a core reads one
 * language and the next has no upgrade (rich-netlist/rnl#686).
 */
export const RNL_UPGRADE_RELEASE = line.upgradeRelease;

/**
 * The Analog Canvas package, not standard: Analog Canvas's appearance
 * variants, and what only Analog Canvas keeps of a drawing. It is published
 * in rich-netlist/rnl-packages, locked by its catalog record and hash
 * (`rnl-canvas-package.lock.json`): the editor ships, reads and writes that
 * one version, a package of the language it writes (decision 0017).
 */
export const CANVAS_PACKAGE = lock.name;
export const CANVAS_PACKAGE_VERSION = lock.versions.at(-1)!.version;
