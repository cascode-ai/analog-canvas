/**
 * A name as RNL writes it after its prefix: plain when it is ASCII letters,
 * digits and underscores, otherwise in double quotes with `"` doubled (3.6).
 */
export function rnlName(prefix: string, name: string): string {
  return /^[A-Za-z0-9_]+$/.test(name)
    ? `${prefix}${name}`
    : `${prefix}"${name.replaceAll('"', '""')}"`;
}
