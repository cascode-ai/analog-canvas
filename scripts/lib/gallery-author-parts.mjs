// How many parts each of an author's Gallery circuits has, from a downloaded
// snapshot. The count is the one the Gallery stores with each entry
// (worker/gallery-components.ts), exactly what the wall's size filter counts.
import { DatabaseSync } from "node:sqlite";

/** The transistor count a circuit's name states ("13T-Adder", "26 transistor"). */
export function claimedTransistors(name) {
  const match = /(\d+)\s*-?\s*(?:T\b|transistors?\b)/iu.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * MOS and bipolar symbols a one-Cell drawing draws, or null for a hierarchy,
 * whose transistor total depends on how often each Cell is placed.
 */
export function drawnTransistors(projectText) {
  const project = JSON.parse(projectText);
  if (project.documents.length !== 1) return null;
  const top = project.documents[0];
  const deviceClass = new Map(
    (project.componentDefinitions ?? []).map((definition) => [
      definition.symbol?.id,
      definition.electrical?.deviceClass,
    ]),
  );
  return (top?.instances ?? []).filter((instance) =>
    ["mos", "bjt"].includes(deviceClass.get(instance.type)),
  ).length;
}

/**
 * Every entry of one account, oldest first. `author` names the byline; when
 * two accounts share it, `owner` (the account id) must say which.
 */
export function readAuthorEntries(databasePath, { author, owner }) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('gallery_entries')")
      .all()
      .map((column) => column.name);
    if (!columns.includes("component_count"))
      throw new Error(
        "This snapshot predates stored part counts; download a newer one",
      );
    let account = owner;
    if (!account) {
      const owners = db
        .prepare(
          "SELECT DISTINCT owner_user_id AS id FROM gallery_entries WHERE lower(author) = lower(?)",
        )
        .all(author)
        .map((row) => row.id);
      if (owners.length !== 1)
        throw new Error(
          owners.length === 0
            ? `No Gallery entry has the byline "${author}"`
            : `Several accounts publish as "${author}" (${owners.join(", ")}); pass --owner`,
        );
      account = owners[0];
    }
    const entries = db
      .prepare(
        `SELECT id, name, author, status, created_at AS createdAt,
                component_count AS parts, component_count_version AS rule,
                project_text AS projectText
         FROM gallery_entries WHERE owner_user_id = ? ORDER BY created_at, id`,
      )
      .all(account);
    return { owner: account, entries };
  } finally {
    db.close();
  }
}

/**
 * An account's public circuits after the already counted ones, with their
 * parts. Public circuits are numbered from 1 by upload time; `from` starts at
 * a number and `after` after an entry's upload (safer: numbers shift when an
 * older circuit is withdrawn). Withdrawn circuits in the window are listed,
 * not counted.
 */
export function countAuthorParts(entries, { from, after } = {}) {
  const numbered = entries
    .filter((entry) => entry.status === "public")
    .map((entry, index) => ({ ...entry, number: index + 1 }));
  // Both forms name the last counted upload; everything later is counted.
  let since = "";
  if (after) {
    const counted = entries.find((entry) => entry.id === after);
    if (!counted) throw new Error(`No entry ${after} belongs to this account`);
    since = counted.createdAt;
  } else if (from > 1) {
    const counted = numbered[from - 2];
    if (!counted)
      throw new Error(`There are only ${numbered.length} public circuits`);
    since = counted.createdAt;
  }
  const window = numbered.filter((entry) => entry.createdAt > since);
  const stale = window.filter((entry) => !entry.rule);
  if (stale.length)
    throw new Error(
      `Part counts are not stored yet for ${stale.map((entry) => entry.id).join(", ")}; take a newer snapshot`,
    );
  const circuits = window.map((entry) => {
    const claimed = claimedTransistors(entry.name);
    const drawn = drawnTransistors(entry.projectText);
    return {
      number: entry.number,
      id: entry.id,
      name: entry.name.replace(/\s+/gu, " ").trim(),
      createdAt: entry.createdAt,
      parts: entry.parts,
      ...(claimed !== null && drawn !== null && claimed !== drawn
        ? { transistors: { claimed, drawn } }
        : {}),
    };
  });
  return {
    circuits,
    withdrawn: entries
      .filter((entry) => entry.status !== "public" && entry.createdAt > since)
      .map(({ id, name, status, createdAt }) => ({
        id,
        name,
        status,
        createdAt,
      })),
    parts: circuits.reduce((sum, entry) => sum + entry.parts, 0),
    nextAfter: circuits.at(-1)?.id ?? after ?? null,
  };
}
