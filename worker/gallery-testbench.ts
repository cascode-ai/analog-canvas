// A circuit's testbench — its simulation folders: sources, analyses,
// measurements and specs — is its author's (#1545). The Gallery stores it
// beside the Project Code, in each entry's and version's `testbench_text`,
// and serves it back only to the readers `readsTestbench` names.

/**
 * The top-level keys Project Code keeps the testbench under: schema 50 on,
 * and 42 to 49. Older Project Code keeps one `simulation` (LEGACY_TESTBENCH).
 */
const TESTBENCH_KEYS = ["simulationFolders", "simulationSetups"] as const;

/**
 * Stored rows whose indented Project Code still holds a testbench: what the
 * maintenance pass moves. A non-empty array of folders always opens its own
 * line; an emptied one reads `[]`.
 */
export const INLINE_TESTBENCH = `(${TESTBENCH_KEYS.map(
  (key) => `instr(project_text, char(10) || '  "${key}": [' || char(10)) > 0`,
).join(" OR ")})`;

/**
 * Stored rows from before schema 42, whose one `simulation` the schema pass
 * (`schema-current`) converts to folders before this pass can move them.
 */
export const LEGACY_TESTBENCH = `instr(project_text, char(10) || '  "simulation": {') > 0`;

/**
 * Where the testbench's value stands in indented Project Code, or null when
 * the text has no such key: a raw newline never occurs inside a JSON string,
 * so a newline and two spaces before the key mark the top level.
 */
function testbenchSpan(
  projectText: string,
): { key: string; start: number; end: number } | null {
  for (const key of TESTBENCH_KEYS) {
    const marker = `\n  "${key}": `;
    const at = projectText.indexOf(marker);
    if (at < 0) continue;
    const start = at + marker.length;
    if (projectText[start] !== "[") return null;
    let depth = 0;
    let quoted = false;
    for (let index = start; index < projectText.length; index += 1) {
      const character = projectText[index];
      if (quoted) {
        if (character === "\\") index += 1;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === "[" || character === "{") depth += 1;
      else if ((character === "]" || character === "}") && --depth === 0)
        return { key, start, end: index + 1 };
    }
    return null;
  }
  return null;
}

/**
 * Indented Project Code split from its testbench: the text with the value
 * emptied to `[]` and every other byte as it was, and the value's exact text
 * (null when the Project has none). Null for text this cannot split that way
 * (not indented, or from before schema 42). Project Code a write stores is
 * serialized, so a write always splits.
 */
export function splitTestbench(
  projectText: string,
): { projectText: string; testbench: string | null; key: string } | null {
  const span = testbenchSpan(projectText);
  if (!span) return null;
  const value = projectText.slice(span.start, span.end);
  if (/^\[\s*\]$/u.test(value))
    return { projectText, testbench: null, key: span.key };
  return {
    projectText: `${projectText.slice(0, span.start)}[]${projectText.slice(span.end)}`,
    testbench: value,
    key: span.key,
  };
}

/** What a write stores: Project Code without its testbench, and the testbench. */
export function storedProject(projectText: string): {
  projectText: string;
  testbench: string | null;
} {
  const split = splitTestbench(projectText);
  if (!split) throw new Error("Project Code to store must be serialized");
  return { projectText: split.projectText, testbench: split.testbench };
}

/**
 * A stored row's testbench: its own column, or, for a row the maintenance
 * pass has not reached, what its Project Code still holds.
 */
export function testbenchOf(row: {
  project_text: string;
  testbench_text?: string | null | undefined;
}): string | null {
  return (
    row.testbench_text ?? splitTestbench(row.project_text)?.testbench ?? null
  );
}

/**
 * Project Code with its testbench back where splitTestbench took it from,
 * byte for byte. Text that still holds one of its own (stored before the
 * move) answers as it is.
 */
export function withTestbench(
  projectText: string,
  testbench: string | null | undefined,
): string {
  if (!testbench) return projectText;
  const span = testbenchSpan(projectText);
  if (!span || !/^\[\s*\]$/u.test(projectText.slice(span.start, span.end)))
    return projectText;
  return `${projectText.slice(0, span.start)}${testbench}${projectText.slice(span.end)}`;
}

/**
 * Project Code for a reader who may not read its testbench: what the store
 * holds once it moved, and the same for a row still waiting for the move.
 * Text that does not split (not indented, or from before schema 42) loses
 * its testbench keys' contents through JSON instead.
 */
export function withoutTestbench(projectText: string): string {
  const split = splitTestbench(projectText);
  if (split) return split.projectText;
  try {
    const raw = JSON.parse(projectText) as Record<string, unknown>;
    for (const key of TESTBENCH_KEYS)
      if (Array.isArray(raw[key])) raw[key] = [];
    delete raw.simulation;
    return `${JSON.stringify(raw, null, 2)}\n`;
  } catch {
    // Never stored: every write serializes the Project as a JSON object.
    return projectText;
  }
}
