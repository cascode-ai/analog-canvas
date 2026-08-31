/**
 * The compatibility window is deliberately explicit: it reaches exactly as
 * far back as the upgrade chain in previous-to-current.ts can carry a file
 * forward. A saved `.icproj.json` is the canonical Project, so a version may
 * leave this window only when its files can no longer exist in the wild —
 * never merely because the schema moved on (#446 was users' saved files
 * refused three days after saving, while the schema advanced 11 versions in
 * nine days).
 */
export const OLDEST_SUPPORTED_PROJECT_SCHEMA_VERSION = 24;
export const PREVIOUS_PROJECT_SCHEMA_VERSION = 31;
