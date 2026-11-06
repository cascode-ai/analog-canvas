// The Gallery's statistics: the whole community Gallery's distributions,
// and each account's, with its public circuits' part and transistor counts.
// Device counts are read from the stored Project, so they are kept in small
// tables of their own, beside their rule's version: the wall's covering
// indexes, which the part count rides in, stay as they are.

import { parseProject } from "@icm/project-protocol";
import {
  DEVICE_COUNT_RULE_VERSION,
  GALLERY_COMPONENT_RANGES,
  GALLERY_DEVICE_KINDS,
  galleryDeviceCounts,
  type GalleryDeviceKind,
} from "./gallery-components";
import { type SqlStorage, unwrapTags } from "./gallery-store";
import { tagType } from "./gallery-store-boards";

export function installTransistorCounts(sql: SqlStorage): void {
  // A row here marks an entry counted at its rule version. A count of null:
  // a Project this build cannot read, not tried again until the rule changes.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS gallery_entry_transistors (
      entry_id TEXT PRIMARY KEY,
      transistors INTEGER,
      rule_version INTEGER NOT NULL
    ) WITHOUT ROWID
  `);
  // Its devices by kind, nonzero kinds only, written with that row.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS gallery_entry_devices (
      entry_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (entry_id, kind)
    ) WITHOUT ROWID
  `);
}

/** A changed or reused entry's counts are read again. Callers own the transaction. */
export function forgetTransistorCount(sql: SqlStorage, entryId: string): void {
  sql.exec("DELETE FROM gallery_entry_transistors WHERE entry_id = ?", entryId);
  sql.exec("DELETE FROM gallery_entry_devices WHERE entry_id = ?", entryId);
}

/** The join that gives an entry `e` its current count as `t.transistors`. */
export const CURRENT_TRANSISTORS = `LEFT JOIN gallery_entry_transistors t
  ON t.entry_id = e.id AND t.rule_version = ${DEVICE_COUNT_RULE_VERSION}`;

const TRANSISTOR_KINDS = new Set<string>(["nmos", "pmos", "bjt"]);

/** Count and keep the devices of these entries, one Project at a time. */
function countTransistors(sql: SqlStorage, ids: readonly string[]): void {
  for (const id of ids) {
    const row = sql
      .exec<{
        project_text: string;
      }>("SELECT project_text FROM gallery_entries WHERE id = ?", id)
      .toArray()[0];
    if (!row) continue;
    let devices: Partial<Record<GalleryDeviceKind, number>> | null;
    try {
      devices = galleryDeviceCounts(parseProject(row.project_text));
    } catch {
      devices = null;
    }
    const transistors =
      devices === null
        ? null
        : Object.entries(devices)
            .filter(([kind]) => TRANSISTOR_KINDS.has(kind))
            .reduce((sum, [, count]) => sum + count, 0);
    sql.exec("DELETE FROM gallery_entry_devices WHERE entry_id = ?", id);
    for (const [kind, count] of Object.entries(devices ?? {}))
      sql.exec(
        "INSERT INTO gallery_entry_devices(entry_id, kind, count) VALUES (?, ?, ?)",
        id,
        kind,
        count,
      );
    sql.exec(
      `INSERT INTO gallery_entry_transistors(entry_id, transistors, rule_version)
       VALUES (?, ?, ?)
       ON CONFLICT(entry_id) DO UPDATE SET
         transistors = excluded.transistors,
         rule_version = excluded.rule_version`,
      id,
      transistors,
      DEVICE_COUNT_RULE_VERSION,
    );
  }
}

/** The public entries of one author key whose count is missing or stale. */
function uncounted(
  sql: SqlStorage,
  author: { sql: string; binding: string },
  limit: number,
): string[] {
  return sql
    .exec<{ id: string }>(
      `SELECT e.id FROM gallery_entries e INDEXED BY idx_gallery_entries_card
       ${CURRENT_TRANSISTORS}
       WHERE e.status = 'public' AND ${author.sql} AND t.entry_id IS NULL
       ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
      author.binding,
      limit,
    )
    .toArray()
    .map((row) => row.id);
}

/**
 * The circuits an author key names: an account ID, or `legacy:` and the
 * byline of an entry no account owns, as the Owner's Data tab keys authors.
 */
function authorCondition(key: string): {
  sql: string;
  binding: string;
} {
  return key.startsWith("legacy:")
    ? {
        sql: "COALESCE(e.owner_user_id, '') = '' AND e.author = ?",
        binding: key.slice("legacy:".length),
      }
    : { sql: "e.owner_user_id = ?", binding: key };
}

/**
 * How many uncounted circuits one read counts before it answers; the
 * scheduled pass counts the rest, so a read never stalls on a large account.
 */
const COUNTED_PER_READ = 400;

/** Count one author's circuits that have no current count yet. */
export function countAuthorTransistors(sql: SqlStorage, key: string): void {
  countTransistors(sql, uncounted(sql, authorCondition(key), COUNTED_PER_READ));
}

/**
 * One author's public circuits, newest first, each with its part count (the
 * wall's, null while unknown) and its transistor count.
 */
export function circuitStats(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const key = typeof body.author === "string" ? body.author : "";
  if (!key) return Response.json({ error: "author-required" }, { status: 400 });
  countAuthorTransistors(sql, key);
  const author = authorCondition(key);
  const rows = sql
    .exec<{
      id: string;
      name: string;
      created_at: string;
      components: number | null;
      transistors: number | null;
    }>(
      `SELECT e.id, e.name, e.created_at,
              CASE WHEN e.component_count_version > 0
                THEN e.component_count END AS components,
              t.transistors
       FROM gallery_entries e INDEXED BY idx_gallery_entries_card
       ${CURRENT_TRANSISTORS}
       WHERE e.status = 'public' AND ${author.sql}
       ORDER BY e.created_at DESC, e.id DESC`,
      author.binding,
    )
    .toArray();
  return Response.json({
    circuits: rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      components: row.components === null ? null : Number(row.components),
      transistors: row.transistors === null ? null : Number(row.transistors),
    })),
    ...authorStats(sql, key),
  });
}

/** How many circuits fall in each transistor bin: a circuit's count picks one. */
const TRANSISTOR_BINS = [
  { key: "0", min: 0, max: 0 },
  { key: "1-5", min: 1, max: 5 },
  { key: "6-10", min: 6, max: 10 },
  { key: "11-20", min: 11, max: 20 },
  { key: "21-50", min: 21, max: 50 },
  { key: "51-", min: 51, max: null },
] as const;
/** The weeks the publishing chart covers, the current one last. */
const STATS_WEEKS = 16;
const TOP_TAGS = 12;
const TOP_AUTHORS = 10;
/** How many uncounted circuits a Gallery read counts before it answers. */
const COUNTED_PER_GALLERY_READ = 200;

/**
 * The distributions the Statistics tab draws, for the whole community
 * Gallery or one author's public circuits. Every figure is a count of public
 * circuits, or of their parts, likes and devices.
 */
export interface GalleryStatsSummary {
  circuits: number;
  authors: number;
  /** Parts, and transistors of the circuits counted so far (`counted`). */
  components: number;
  transistors: number;
  counted: number;
  ai: number;
  netlist: number;
  /** Likes received, and how many circuits have at least one. */
  likes: number;
  liked: number;
  /** One type per circuit, its first tag of a circuit-function group; null: none. */
  types: { type: string | null; circuits: number }[];
  tags: { tag: string; circuits: number }[];
  devices: { kind: GalleryDeviceKind; count: number }[];
  sizes: { key: string; circuits: number }[];
  transistorBins: { key: string; circuits: number }[];
  /** Circuits published each week (Monday, UTC), by people and by AI. */
  weeks: { week: string; human: number; ai: number }[];
}

/** The Monday (UTC) of the week `iso` falls in. */
function weekOf(iso: string): string {
  const day = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

function binOf(
  bins: readonly { key: string; min: number; max: number | null }[],
  value: number,
): string | undefined {
  return bins.find(
    (bin) => value >= bin.min && (bin.max === null || value <= bin.max),
  )?.key;
}

const tally = <Key>(map: Map<Key, number>, key: Key, amount = 1) =>
  map.set(key, (map.get(key) ?? 0) + amount);

function summarize(
  sql: SqlStorage,
  author: { sql: string; binding: string } | null,
  now: Date,
): GalleryStatsSummary {
  const where = author ? `AND ${author.sql}` : "";
  const bindings = author ? [author.binding] : [];
  const rows = sql
    .exec<{
      key: string;
      created_at: string;
      tags: string;
      ai: number;
      netlist: number;
      components: number | null;
      transistors: number | null;
      counted: number;
      likes: number;
    }>(
      `SELECT COALESCE(NULLIF(e.owner_user_id, ''), 'legacy:' || e.author)
                AS key,
              e.created_at, e.tags, e.ai_generated AS ai,
              e.netlistable AS netlist,
              CASE WHEN e.component_count_version > 0
                THEN e.component_count END AS components,
              t.transistors, t.entry_id IS NOT NULL AS counted,
              (SELECT COUNT(*) FROM gallery_likes l WHERE l.entry_id = e.id)
                AS likes
       FROM gallery_entries e INDEXED BY idx_gallery_entries_feed_stats_wall
       ${CURRENT_TRANSISTORS}
       WHERE e.status = 'public' ${where}`,
      ...bindings,
    )
    .toArray();
  const devices = new Map(
    sql
      .exec<{ kind: string; count: number }>(
        `SELECT d.kind, SUM(d.count) AS count
         FROM gallery_entries e INDEXED BY idx_gallery_entries_feed_stats_wall
         JOIN gallery_entry_transistors t
           ON t.entry_id = e.id AND t.rule_version = ${DEVICE_COUNT_RULE_VERSION}
         JOIN gallery_entry_devices d ON d.entry_id = e.id
         WHERE e.status = 'public' ${where}
         GROUP BY d.kind`,
        ...bindings,
      )
      .toArray()
      .map((row) => [row.kind, Number(row.count)]),
  );
  const authors = new Set<string>();
  const types = new Map<string | null, number>();
  const tags = new Map<string, number>();
  const sizes = new Map<string, number>();
  const transistorBins = new Map<string, number>();
  const weeks = new Map<string, { human: number; ai: number }>();
  const thisWeek = weekOf(now.toISOString());
  for (let index = STATS_WEEKS - 1; index >= 0; index -= 1) {
    const week = new Date(`${thisWeek}T00:00:00.000Z`);
    week.setUTCDate(week.getUTCDate() - 7 * index);
    weeks.set(week.toISOString().slice(0, 10), { human: 0, ai: 0 });
  }
  const summary = {
    components: 0,
    transistors: 0,
    counted: 0,
    ai: 0,
    netlist: 0,
    likes: 0,
    liked: 0,
  };
  for (const row of rows) {
    authors.add(row.key);
    tally(types, tagType(row.tags));
    for (const tag of new Set(unwrapTags(row.tags))) tally(tags, tag);
    const ai = Number(row.ai) === 1;
    if (ai) summary.ai += 1;
    if (Number(row.netlist) === 1) summary.netlist += 1;
    const likes = Number(row.likes);
    summary.likes += likes;
    if (likes > 0) summary.liked += 1;
    if (row.components !== null) {
      const components = Number(row.components);
      summary.components += components;
      const size = binOf(GALLERY_COMPONENT_RANGES, components);
      if (size) tally(sizes, size);
    }
    if (Number(row.counted) === 1) summary.counted += 1;
    if (row.transistors !== null) {
      const transistors = Number(row.transistors);
      summary.transistors += transistors;
      const bin = binOf(TRANSISTOR_BINS, transistors);
      if (bin) tally(transistorBins, bin);
    }
    const week = weeks.get(weekOf(row.created_at));
    if (week) week[ai ? "ai" : "human"] += 1;
  }
  const byCount = <Key>(map: Map<Key, number>) =>
    [...map.entries()].sort(
      ([leftKey, left], [rightKey, right]) =>
        right - left || String(leftKey).localeCompare(String(rightKey)),
    );
  return {
    circuits: rows.length,
    authors: authors.size,
    ...summary,
    types: byCount(types).map(([type, circuits]) => ({ type, circuits })),
    tags: byCount(tags)
      .slice(0, TOP_TAGS)
      .map(([tag, circuits]) => ({ tag, circuits })),
    devices: GALLERY_DEVICE_KINDS.map((kind) => ({
      kind,
      count: devices.get(kind) ?? 0,
    })),
    sizes: GALLERY_COMPONENT_RANGES.map(({ key }) => ({
      key,
      circuits: sizes.get(key) ?? 0,
    })),
    transistorBins: TRANSISTOR_BINS.map(({ key }) => ({
      key,
      circuits: transistorBins.get(key) ?? 0,
    })),
    weeks: [...weeks.entries()].map(([week, made]) => ({ week, ...made })),
  };
}

/** Every author's public circuits, most first, as the Gallery's authors count them. */
function authorCounts(
  sql: SqlStorage,
): { key: string; author: string; circuits: number }[] {
  return sql
    .exec<{ key: string; author: string; circuits: number }>(
      `SELECT COALESCE(NULLIF(e.owner_user_id, ''), 'legacy:' || e.author)
                AS key,
              MAX(e.author) AS author, COUNT(*) AS circuits
       FROM gallery_entries e INDEXED BY idx_gallery_entries_feed_stats_wall
       WHERE e.status = 'public' AND TRIM(e.author) <> ''
       GROUP BY key
       ORDER BY circuits DESC, author COLLATE NOCASE ASC, key ASC`,
    )
    .toArray()
    .map((row) => ({ ...row, circuits: Number(row.circuits) }));
}

/**
 * One author's distributions and place among the Gallery's authors: first
 * of `authors` when none published more. Null rank: no public circuit.
 */
export function authorStats(
  sql: SqlStorage,
  key: string,
  now = new Date(),
): {
  summary: GalleryStatsSummary;
  rank: { position: number; authors: number } | null;
} {
  const summary = summarize(sql, authorCondition(key), now);
  const counts = authorCounts(sql);
  return {
    summary,
    rank:
      summary.circuits === 0
        ? null
        : {
            position:
              1 +
              counts.filter((author) => author.circuits > summary.circuits)
                .length,
            authors: counts.length,
          },
  };
}

/**
 * The whole community Gallery's distributions, and its most prolific
 * authors. A read counts some circuits still uncounted first.
 */
export function galleryStats(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  countTransistors(sql, pendingIds(sql, COUNTED_PER_GALLERY_READ));
  const now =
    typeof body.now === "string" && !Number.isNaN(Date.parse(body.now))
      ? new Date(body.now)
      : new Date();
  return Response.json({
    summary: summarize(sql, null, now),
    topAuthors: authorCounts(sql)
      .slice(0, TOP_AUTHORS)
      .map(({ author, circuits }) => ({ author, circuits })),
  });
}

/** Public entries with no current count, in ID order. */
function pendingIds(sql: SqlStorage, limit: number): string[] {
  return sql
    .exec<{ id: string }>(
      `SELECT e.id FROM gallery_entries e INDEXED BY idx_gallery_entries_card
       ${CURRENT_TRANSISTORS}
       WHERE e.status = 'public' AND t.entry_id IS NULL
       ORDER BY e.id LIMIT ?`,
      limit,
    )
    .toArray()
    .map((row) => row.id);
}

/**
 * One batch of the scheduled pass: the public entries with no current
 * device count are counted, and counts whose entry is gone are dropped.
 * When everything is counted the pass reads one index and stops.
 */
export function refreshTransistorCounts(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 400);
  const ids = pendingIds(sql, limit);
  countTransistors(sql, ids);
  for (const table of ["gallery_entry_transistors", "gallery_entry_devices"])
    sql.exec(
      `DELETE FROM ${table}
       WHERE entry_id NOT IN (SELECT id FROM gallery_entries)`,
    );
  const remaining = Number(
    sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM gallery_entries e INDEXED BY idx_gallery_entries_card
         ${CURRENT_TRANSISTORS}
         WHERE e.status = 'public' AND t.entry_id IS NULL`,
      )
      .toArray()[0]?.count ?? 0,
  );
  return Response.json({ counted: ids.length, remaining });
}

/**
 * One batch of the Owner's Recount: every public entry after `after`, in ID
 * order, counted again whatever its count, so a full recount leaves no gap
 * in the totals. `next` resumes it; null when the last batch is done.
 */
export function recountTransistors(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 400);
  const after = typeof body.after === "string" ? body.after : "";
  const ids = sql
    .exec<{ id: string }>(
      `SELECT id FROM gallery_entries
       WHERE status = 'public' AND id > ? ORDER BY id LIMIT ?`,
      after,
      limit,
    )
    .toArray()
    .map((row) => row.id);
  countTransistors(sql, ids);
  const last = ids.at(-1);
  const remaining = last
    ? Number(
        sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM gallery_entries
             WHERE status = 'public' AND id > ?`,
            last,
          )
          .toArray()[0]?.count ?? 0,
      )
    : 0;
  return Response.json({
    counted: ids.length,
    remaining,
    next: remaining > 0 ? last : null,
  });
}
