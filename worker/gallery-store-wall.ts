// The public wall: its feed and filters, search, the counts beside them, the
// catalog, contributors, the Owner's Data tab, and likes.

import {
  GALLERY_COMPONENT_RANGES,
  componentRangeSql,
  requestedComponentRanges,
} from "./gallery-components";
import { GALLERY_ISSUE_KINDS } from "./gallery-curation";
import taxonomy from "../config/gallery-taxonomy.json";
import {
  galleryEntryMatchesQuery,
  normalizeGallerySearchText,
} from "../apps/editor/src/gallery-search";
import {
  type EntrySummaryRow,
  type SqlStorage,
  sanitizeGalleryTags,
  summaryOf,
  unwrapTags,
} from "./gallery-store";

/** Longest search a reader may send; longer text is cut, not refused. */
const GALLERY_MAX_SEARCH_LENGTH = 200;

const GALLERY_TAG_GROUPS = Object.entries(taxonomy.tagsByGroup);
const GALLERY_TAG_ALIASES: Record<string, string> = {
  op: "operational amplifier",
  osc: "oscillator",
  bgr: "bandgap",
  dcdc: "dc-dc",
  "d-latch": "d latch",
  levelshifter: "level shifter",
  sha: "sample and hold",
  "switch capacitor": "switched capacitor",
  cts: "charge transfer switch",
  "v-i": "voltage to current",
  vtc: "voltage to time",
  tdc: "time to digital",
  "gain-boost": "gain boosting",
  "low-dropout": "ldo",
  dropout: "ldo",
  "linear regulator": "regulator",
  "bootstrapped cts": "charge transfer switch",
};

function galleryTagGroup(tag: string): string {
  const normalized = tag.toLowerCase();
  const key = GALLERY_TAG_ALIASES[normalized] ?? normalized;
  return (
    GALLERY_TAG_GROUPS.find(([, values]) => values.includes(key))?.[0] ??
    "Custom & legacy"
  );
}

const GALLERY_DEFAULT_LIST_LIMIT = 30;
const GALLERY_MAX_LIST_LIMIT = 60;

/** The search a feed request asks, if any. */
function requestedSearch(body: Record<string, unknown>): string | null {
  const query =
    typeof body.q === "string"
      ? body.q.slice(0, GALLERY_MAX_SEARCH_LENGTH)
      : "";
  return normalizeGallerySearchText(query) ? query : null;
}

/** An entry whose curation asks its author to look again. */
const NEEDS_ATTENTION =
  "json_extract(CASE WHEN e.curation_json = '' THEN '{}' ELSE e.curation_json END, '$.attention.status') = 'needs-attention'";
/** The findings of an entry's attention, one row each, for json_each. */
const ATTENTION_ISSUES =
  "json_each(CASE WHEN e.curation_json = '' THEN '{}' ELSE e.curation_json END, '$.attention.issues')";

/** The attention reason a request narrows to, when it names a known one. */
function requestedAttentionKind(body: Record<string, unknown>): string | null {
  return body.attention === true &&
    typeof body.attentionKind === "string" &&
    GALLERY_ISSUE_KINDS.includes(body.attentionKind)
    ? body.attentionKind
    : null;
}

/**
 * One thumb per account, and pressing it again takes it back. The entry has
 * to exist and be public: a like is not a way to discover a withdrawn one.
 */
export function toggleLike(
  sql: SqlStorage,
  id: string,
  userId: string,
  at: string,
): Response {
  const entry = sql
    .exec<{ status: string }>(
      "SELECT status FROM gallery_entries WHERE id = ?",
      id,
    )
    .toArray()[0];
  if (!entry || entry.status !== "public") {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  const existing = sql
    .exec<{ entry_id: string }>(
      "SELECT entry_id FROM gallery_likes WHERE entry_id = ? AND user_id = ?",
      id,
      userId,
    )
    .toArray();
  if (existing.length > 0) {
    sql.exec(
      "DELETE FROM gallery_likes WHERE entry_id = ? AND user_id = ?",
      id,
      userId,
    );
  } else {
    sql.exec(
      "INSERT INTO gallery_likes(entry_id, user_id, liked_at) VALUES (?, ?, ?)",
      id,
      userId,
      at,
    );
  }
  const likes =
    sql
      .exec<{
        count: number;
      }>("SELECT COUNT(*) AS count FROM gallery_likes WHERE entry_id = ?", id)
      .toArray()[0]?.count ?? 0;
  return Response.json({ likes, likedByViewer: existing.length === 0 });
}

/**
 * The wall's narrowing, shared by the feed and its tag counts so a filter
 * means the same in both: Needs attention, With netlist and Liked narrow
 * the counts exactly as they narrow the wall. The tag counts leave out the
 * tag selection itself, or checking one tag would zero every other.
 */
function feedConditions(
  sql: SqlStorage,
  body: Record<string, unknown>,
  options: {
    tags: boolean;
    attentionKind?: boolean;
    parts?: boolean;
    /** False leaves out the with/without netlist choice, for its counts. */
    netlist?: boolean;
    /** False leaves out the AI/by-hand choice, for its counts. */
    ai?: boolean;
  },
): {
  conditions: string[];
  bindings: (string | number)[];
  viewerId: string;
} {
  const author =
    typeof body.author === "string" && body.author.length > 0
      ? body.author
      : null;
  const ownerUserId =
    typeof body.ownerUserId === "string" && body.ownerUserId.length > 0
      ? body.ownerUserId
      : null;
  const viewerId = typeof body.viewerId === "string" ? body.viewerId : "";
  const conditions = ["e.status = 'public'"];
  const bindings: (string | number)[] = [];
  if (ownerUserId) {
    conditions.push("e.owner_user_id = ?");
    bindings.push(ownerUserId);
  } else if (author) {
    conditions.push("e.author = ?");
    bindings.push(author);
  }
  if (options.tags) {
    const tags = sanitizeGalleryTags(body.tags, 256);
    if (tags.length > 0) {
      conditions.push(`(${tags.map(() => "e.tags LIKE ?").join(" OR ")})`);
      for (const tag of tags) bindings.push(`%,${tag},%`);
    }
  }
  if (body.attention === true) {
    conditions.push(NEEDS_ATTENTION);
    if (body.isAdmin !== true) {
      conditions.push("e.owner_user_id = ?");
      bindings.push(viewerId);
    }
    // One reason narrows Needs attention to the entries with that finding;
    // the reason counts leave it out, or choosing one would zero the rest.
    const kind =
      options.attentionKind === false ? null : requestedAttentionKind(body);
    if (kind) {
      conditions.push(
        `EXISTS (SELECT 1 FROM ${ATTENTION_ISSUES} AS issue
           WHERE json_extract(issue.value, '$.kind') = ?)`,
      );
      bindings.push(kind);
    }
  }
  // Two pairs whose sides exclude each other. Their counts leave their own
  // choice out, or choosing one side would zero the other beside it.
  if (options.netlist !== false) {
    if (body.netlistable === true) conditions.push("e.netlistable = 1");
    else if (body.withoutNetlist === true) conditions.push("e.netlistable = 0");
  }
  if (options.ai !== false && (body.ai === "ai" || body.ai === "human"))
    conditions.push(`e.ai_generated = ${body.ai === "ai" ? 1 : 0}`);
  // A search narrows the wall before its counts and cursor, so totals, tags,
  // contributors and pages all describe the same circuits.
  const search = requestedSearch(body);
  if (search !== null) {
    conditions.push("e.id IN (SELECT value FROM json_each(?))");
    bindings.push(searchMatches(sql, body, search));
  }
  // Several sizes mean any of them. The size counts leave the choice out,
  // or choosing one size would zero the others beside it.
  const ranges =
    options.parts === false ? [] : requestedComponentRanges(body.parts);
  if (ranges.length > 0) {
    const { sql, bindings: rangeBindings } = componentRangeSql(
      "e.component_count",
      ranges,
    );
    conditions.push(sql);
    bindings.push(...rangeBindings);
  }
  // Whose likes: the session's, so a signed-out reader asking for their
  // liked circuits is answered with none instead of with everybody's.
  if (body.liked === true) {
    conditions.push(
      `EXISTS (SELECT 1 FROM gallery_likes
         WHERE entry_id = e.id AND user_id = ?)`,
    );
    bindings.push(viewerId);
  }
  return { conditions, bindings, viewerId };
}

/**
 * The public circuits a search answers, as a JSON array of IDs. Read from
 * metadata alone, never Project Code or previews, with the same rule the
 * browser narrows loaded circuits by; worked out once per request, however
 * many of its counts ask.
 */
function searchMatches(
  sql: SqlStorage,
  body: Record<string, unknown>,
  search: string,
): string {
  const known = searchMatchesByRequest.get(body);
  if (known !== undefined) return known;
  const rows = sql
    .exec<{
      id: string;
      name: string;
      author: string;
      description: string | null;
      tags: string | null;
    }>(
      `SELECT e.id, e.name, e.author, e.description, e.tags
         FROM gallery_entries e WHERE e.status = 'public'`,
    )
    .toArray();
  const matches = JSON.stringify(
    rows
      .filter((row) =>
        galleryEntryMatchesQuery(
          {
            name: row.name,
            author: row.author,
            description: row.description,
            tags: unwrapTags(row.tags),
          },
          search,
        ),
      )
      .map((row) => row.id),
  );
  searchMatchesByRequest.set(body, matches);
  return matches;
}

const searchMatchesByRequest = new WeakMap<object, string>();

export function list(sql: SqlStorage, body: Record<string, unknown>): Response {
  const limit = Math.min(
    Math.max(Number(body.limit) || GALLERY_DEFAULT_LIST_LIMIT, 1),
    GALLERY_MAX_LIST_LIMIT,
  );
  const cursor = typeof body.cursor === "string" ? body.cursor : null;
  // The viewer id leads the bindings because its sub-select comes first.
  const { conditions, bindings, viewerId } = feedConditions(sql, body, {
    tags: true,
  });
  // The whole filtered wall's size, not the page's: counted before the
  // cursor narrows the query, so every page carries the same total.
  const counts = sql
    .exec<{
      total: number;
      attention: number;
      liked: number;
    }>(
      `SELECT COUNT(*) AS total,
         COUNT(CASE WHEN EXISTS (SELECT 1 FROM gallery_likes
           WHERE entry_id = e.id AND user_id = ?) THEN 1 END) AS liked,
         COUNT(CASE WHEN ? != '' AND (? = 1 OR e.owner_user_id = ?)
           AND ${NEEDS_ATTENTION} THEN 1 END) AS attention
       FROM gallery_entries e WHERE ${conditions.join(" AND ")}`,
      viewerId,
      viewerId,
      body.isAdmin === true ? 1 : 0,
      viewerId,
      ...bindings,
    )
    .toArray()[0]!;
  const pairs = pairCounts(sql, body);
  const attentionKinds =
    body.attention === true ? attentionKindCounts(sql, body) : undefined;
  const componentRanges = componentRangeCounts(sql, body);
  const authors = contributorCounts(sql, conditions, bindings);
  if (cursor) {
    conditions.push("(e.created_at || '|' || e.id) < ?");
    bindings.push(cursor);
  }
  const rows = sql
    .exec<EntrySummaryRow & { likes: number; liked_by_viewer: number }>(
      `SELECT e.id, e.name, e.author, e.description, e.created_at,
         e.owner_user_id,
         e.schema_version, e.tags, e.curation_json, e.netlistable, e.preview_revision,
         e.preview_width, e.preview_height, e.component_count,
         e.component_count_version, e.ai_generated,
         (SELECT COUNT(*) FROM gallery_likes WHERE entry_id = e.id) AS likes,
         (SELECT COUNT(*) FROM gallery_likes
           WHERE entry_id = e.id AND user_id = ?) AS liked_by_viewer
       FROM gallery_entries e WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      viewerId,
      ...bindings,
      limit + 1,
    )
    .toArray();
  const page = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit && page.length > 0
      ? `${page.at(-1)!.created_at}|${page.at(-1)!.id}`
      : null;
  return Response.json({
    entries: page.map((row) =>
      summaryOf(
        row,
        body.isAdmin === true || (!!viewerId && viewerId === row.owner_user_id),
      ),
    ),
    nextCursor,
    total: Number(counts.total),
    // Which search this answers, so a reader knows the counts are its.
    ...(requestedSearch(body) !== null
      ? { search: requestedSearch(body)!.trim() }
      : {}),
    authors,
    filterCounts: {
      attention: Number(counts.attention),
      liked: Number(counts.liked),
      ...pairs,
      ...(attentionKinds ? { attentionKinds } : {}),
      componentRanges,
    },
  });
}

/**
 * Both sides of the two pairs, with netlist and without, AI-generated and
 * by hand, each counted with every other filter applied but its own pair's
 * choice left out: what choosing that side would show.
 */
function pairCounts(
  sql: SqlStorage,
  body: Record<string, unknown>,
): {
  netlistable: number;
  withoutNetlist: number;
  ai: number;
  human: number;
} {
  const count = (
    omit: { netlist: false } | { ai: false },
    column: "netlistable" | "ai_generated",
  ) => {
    const { conditions, bindings } = feedConditions(sql, body, {
      tags: true,
      ...omit,
    });
    return sql
      .exec<{ yes: number; no: number }>(
        `SELECT COUNT(CASE WHEN e.${column} = 1 THEN 1 END) AS yes,
           COUNT(CASE WHEN e.${column} = 0 THEN 1 END) AS no
         FROM gallery_entries e WHERE ${conditions.join(" AND ")}`,
        ...bindings,
      )
      .one();
  };
  const netlist = count({ netlist: false }, "netlistable");
  const ai = count({ ai: false }, "ai_generated");
  return {
    netlistable: Number(netlist.yes),
    withoutNetlist: Number(netlist.no),
    ai: Number(ai.yes),
    human: Number(ai.no),
  };
}

/**
 * How many entries fall in each size, with every other filter applied: the
 * counts beside the size choices.
 */
function componentRangeCounts(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Record<string, number> {
  const { conditions, bindings } = feedConditions(sql, body, {
    tags: true,
    parts: false,
  });
  const columns: string[] = [];
  const columnBindings: number[] = [];
  GALLERY_COMPONENT_RANGES.forEach((range, index) => {
    const { sql, bindings: rangeBindings } = componentRangeSql(
      "e.component_count",
      [range],
    );
    columns.push(`COUNT(CASE WHEN ${sql} THEN 1 END) AS r${index}`);
    columnBindings.push(...rangeBindings);
  });
  const row = sql
    .exec<Record<string, number>>(
      `SELECT ${columns.join(", ")}
       FROM gallery_entries e WHERE ${conditions.join(" AND ")}`,
      ...columnBindings,
      ...bindings,
    )
    .toArray()[0];
  return Object.fromEntries(
    GALLERY_COMPONENT_RANGES.map((range, index) => [
      range.key,
      Number(row?.[`r${index}`] ?? 0),
    ]),
  );
}

/**
 * How many entries under Needs attention carry each reason, with every
 * other filter applied: the counts beside the reason menu.
 */
function attentionKindCounts(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Record<string, number> {
  const { conditions, bindings } = feedConditions(sql, body, {
    tags: true,
    attentionKind: false,
  });
  const counts: Record<string, number> = {};
  for (const row of sql
    .exec<{ kind: string; count: number }>(
      `SELECT json_extract(issue.value, '$.kind') AS kind,
         COUNT(DISTINCT e.id) AS count
       FROM gallery_entries e, ${ATTENTION_ISSUES} AS issue
       WHERE ${conditions.join(" AND ")}
       GROUP BY kind`,
      ...bindings,
    )
    .toArray()) {
    if (GALLERY_ISSUE_KINDS.includes(row.kind))
      counts[row.kind] = Number(row.count);
  }
  return counts;
}

/** Complete public metadata index for server-rendered, directly readable pages. */
export function catalog(sql: SqlStorage): Response {
  const rows = sql
    .exec<EntrySummaryRow & { likes: number }>(
      `SELECT e.id, e.name, e.author, e.description, e.created_at,
         e.owner_user_id, e.schema_version, e.tags, e.curation_json,
         e.netlistable, e.ai_generated, e.preview_revision, e.preview_width,
         e.preview_height,
         (SELECT COUNT(*) FROM gallery_likes WHERE entry_id = e.id) AS likes
       FROM gallery_entries e WHERE e.status = 'public'
       ORDER BY e.name COLLATE NOCASE ASC, e.name ASC, e.id ASC`,
    )
    .toArray();
  const entries = rows.map((row) => summaryOf(row));
  const tagCounts = new Map<string, number>();
  const groupCounts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    for (const group of new Set(entry.tags.map(galleryTagGroup))) {
      groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
    }
  }
  return Response.json({
    entries,
    total: entries.length,
    netlistable: entries.filter((entry) => entry.netlistable).length,
    tags: [...tagCounts.entries()]
      .sort((left, right) => left[0].localeCompare(right[0], "en"))
      .map(([tag, count]) => ({ tag, count, group: galleryTagGroup(tag) })),
    groups: [...groupCounts.entries()]
      .sort((left, right) => left[0].localeCompare(right[0], "en"))
      .map(([group, count]) => ({ group, count })),
    authors: contributorCounts(sql, ["e.status = 'public'"], []),
  });
}

/**
 * The Owner's Data tab (#1446): each author's public circuits counted, or
 * with `author` (an account ID, or `legacy:` and a byline) that author's
 * public circuits. Public facts only: what the wall shows.
 */
export function ownerData(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const likes =
    "(SELECT COUNT(*) FROM gallery_likes l WHERE l.entry_id = e.id)";
  const parts =
    "CASE WHEN e.component_count_version > 0 THEN e.component_count END";
  if (typeof body.author === "string") {
    const legacy = body.author.startsWith("legacy:")
      ? body.author.slice("legacy:".length)
      : null;
    const rows = sql
      .exec<{
        id: string;
        name: string;
        created_at: string;
        parts: number | null;
        netlistable: number;
        ai_generated: number;
        likes: number;
      }>(
        `SELECT e.id, e.name, e.created_at, ${parts} AS parts,
                e.netlistable, e.ai_generated, ${likes} AS likes
         FROM gallery_entries e
         WHERE e.status = 'public' AND ${
           legacy === null
             ? "e.owner_user_id = ?"
             : "COALESCE(e.owner_user_id, '') = '' AND e.author = ?"
         }
         ORDER BY e.created_at DESC, e.id DESC`,
        legacy ?? body.author,
      )
      .toArray();
    return Response.json({
      circuits: rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        parts: row.parts,
        netlistable: row.netlistable === 1,
        aiGenerated: row.ai_generated === 1,
        likes: Number(row.likes),
      })),
    });
  }
  const authors = sql
    .exec<{
      author: string;
      key: string;
      circuits: number;
      parts: number | null;
      ai: number;
      netlist: number;
      likes: number;
      latest: string;
    }>(
      `SELECT MAX(e.author) AS author,
              COALESCE(NULLIF(e.owner_user_id, ''), 'legacy:' || e.author)
                AS key,
              COUNT(*) AS circuits, AVG(${parts}) AS parts,
              SUM(e.ai_generated = 1) AS ai, SUM(e.netlistable = 1) AS netlist,
              SUM(${likes}) AS likes, MAX(e.created_at) AS latest
       FROM gallery_entries e
       WHERE e.status = 'public' AND TRIM(e.author) <> ''
       GROUP BY key
       ORDER BY circuits DESC, author COLLATE NOCASE ASC, author ASC`,
    )
    .toArray();
  return Response.json({
    authors: authors.map((row) => ({
      author: row.author,
      key: row.key,
      circuits: Number(row.circuits),
      averageParts:
        row.parts === null ? null : Math.round(Number(row.parts) * 10) / 10,
      ai: Number(row.ai),
      withNetlist: Number(row.netlist),
      likes: Number(row.likes),
      latest: row.latest,
    })),
  });
}

/** Public tag counts plus deduplicated circuit totals for each visual group. */
export function tagCounts(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const { conditions, bindings } = feedConditions(sql, body, {
    tags: false,
  });
  const rows = sql
    .exec<{ tags: string | null }>(
      `SELECT e.tags FROM gallery_entries e WHERE ${conditions.join(" AND ")}`,
      ...bindings,
    )
    .toArray();
  const counts = new Map<string, number>();
  const groupCounts = new Map<string, number>();
  for (const row of rows) {
    const rowTags = unwrapTags(row.tags);
    for (const tag of rowTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    for (const group of new Set(rowTags.map(galleryTagGroup))) {
      groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
    }
  }
  const tags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"))
    .map(([tag, count]) => ({ tag, count }));
  const groups = [...groupCounts.entries()].map(([group, count]) => ({
    group,
    count,
  }));
  return Response.json({ tags, groups });
}

/** Public contributors ranked by visible circuits and keyed by identity. */
export function authorCounts(sql: SqlStorage): Response {
  return Response.json({
    authors: contributorCounts(sql, ["e.status = 'public'"], []),
  });
}

function contributorCounts(
  sql: SqlStorage,
  conditions: readonly string[],
  bindings: readonly (string | number)[],
) {
  const rows = sql
    .exec<{
      author: string;
      owner_user_id: string | null;
      count: number;
    }>(
      `SELECT MAX(e.author) AS author, e.owner_user_id, COUNT(*) AS count
       FROM gallery_entries e
       WHERE ${conditions.join(" AND ")} AND TRIM(e.author) <> ''
       GROUP BY COALESCE(NULLIF(e.owner_user_id, ''), 'legacy:' || e.author)
       ORDER BY count DESC, author COLLATE NOCASE ASC, author ASC`,
      ...bindings,
    )
    .toArray();
  return rows.map((row) => ({
    author: row.author,
    ownerUserId: row.owner_user_id,
    count: Number(row.count),
  }));
}
