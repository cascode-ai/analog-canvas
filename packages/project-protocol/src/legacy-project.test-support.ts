import { transformShortProjectFields } from "./project-file-short-fields.js";

/** Build inputs for historical envelope rule tests. The corpus holds shipped bytes. */
export function legacyProjectFile(text: string, schemaVersion: number) {
  const file = JSON.parse(text);
  transformShortProjectFields(file, true);
  file.schemaVersion = schemaVersion;
  return file;
}
