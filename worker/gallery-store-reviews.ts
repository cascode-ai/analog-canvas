// Reviews of Gallery drawings: who passed or flagged which version of an
// entry, and why. Rows are only ever added (an Owner may mark an issue
// resolved), so the history stays. A review counts while its version is
// the entry's current preview; an update leaves earlier ones in the
// history, no longer current.

import { type SqlStorage, isRecord } from "./gallery-store";
import { allFixers, entryFixes, fixTotals } from "./gallery-store-fixes";

/** What a reviewer can flag; the page names them. */
const REVIEW_FLAGS = [
  "wrong",
  "netlist",
  "loose",
  "ugly",
  "overlap",
  "wiring",
  "incomplete",
  "simple",
  "duplicate",
  "other",
] as const;
/** Reviews one account may write in a store each UTC day. */
const REVIEW_DAILY_LIMIT = 300;
const NOTE_LIMIT = 1000;

export function installReviews(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS entry_reviews (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      preview_revision TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      reviewer_name TEXT NOT NULL,
      verdict TEXT NOT NULL,
      flags TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by TEXT
    ) WITHOUT ROWID
  `);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_entry_reviews_entry
    ON entry_reviews(entry_id, created_at)`);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_entry_reviews_reviewer
    ON entry_reviews(reviewer_id, created_at)`);
  // Boxes the reviewer drew on the pictures, as JSON (see reviewMarks).
  try {
    sql.exec(
      "ALTER TABLE entry_reviews ADD COLUMN marks TEXT NOT NULL DEFAULT ''",
    );
  } catch {
    // Column already present.
  }
}

/** A box on one of the two pictures, in fractions of its width and height. */
interface ReviewMark {
  side: "original" | "redraw";
  x: number;
  y: number;
  w: number;
  h: number;
}
const MARK_LIMIT = 12;

/**
 * A review's boxes: at most MARK_LIMIT, each on a side and inside its
 * picture, rounded to four places. Null when any is not one.
 */
function reviewMarks(value: unknown): ReviewMark[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MARK_LIMIT) return null;
  const marks: ReviewMark[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const side = item.side;
    const [x, y, w, h] = [item.x, item.y, item.w, item.h].map(Number);
    if (
      (side !== "original" && side !== "redraw") ||
      ![x, y, w, h].every((part) => Number.isFinite(part)) ||
      x! < 0 ||
      y! < 0 ||
      w! <= 0 ||
      h! <= 0 ||
      x! + w! > 1.0001 ||
      y! + h! > 1.0001
    )
      return null;
    const round = (part: number) => Math.round(part * 10_000) / 10_000;
    marks.push({
      side,
      x: round(x!),
      y: round(y!),
      w: round(w!),
      h: round(h!),
    });
  }
  return marks;
}

interface ReviewRow {
  id: string;
  entry_id: string;
  preview_revision: string;
  reviewer_id: string;
  reviewer_name: string;
  verdict: string;
  flags: string;
  note: string;
  marks?: string;
  created_at: string;
  resolved_at: string | null;
}

function shown(row: ReviewRow, current: string | undefined) {
  let marks: ReviewMark[] = [];
  try {
    marks = row.marks ? (reviewMarks(JSON.parse(row.marks)) ?? []) : [];
  } catch {
    marks = [];
  }
  return {
    id: row.id,
    entryId: row.entry_id,
    revision: row.preview_revision,
    current: row.preview_revision === current,
    reviewer: row.reviewer_name,
    verdict: row.verdict,
    flags: row.flags ? row.flags.split(",") : [],
    note: row.note,
    marks,
    at: row.created_at,
    resolved: row.resolved_at !== null,
  };
}

/**
 * Each reviewer's latest review of each entry at its current version: the
 * reviews that count. `reviewerId` narrows them to one reviewer.
 */
function currentReviews(
  sql: SqlStorage,
  where = "",
  ...bindings: unknown[]
): ReviewRow[] {
  return sql
    .exec<ReviewRow>(
      // From the reviews (CROSS JOIN keeps that order), each entry by its
      // card index: never the entries' rows, which hold their drawings.
      `SELECT r.* FROM entry_reviews r
       CROSS JOIN gallery_entries e ON e.id = r.entry_id AND e.status = 'public'
         AND r.preview_revision = e.preview_revision
       WHERE r.created_at = (
         SELECT MAX(created_at) FROM entry_reviews l
         WHERE l.entry_id = r.entry_id AND l.reviewer_id = r.reviewer_id
           AND l.preview_revision = r.preview_revision)
       ${where}`,
      ...bindings,
    )
    .toArray();
}

/** Add one review of an entry's current version. */
export function submitReview(sql: SqlStorage, body: unknown): Response {
  if (!isRecord(body))
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  const entryId = String(body.entryId ?? "");
  const reviewerId = String(body.reviewerId ?? "");
  const verdict = String(body.verdict ?? "");
  const flags = Array.isArray(body.flags) ? body.flags : [];
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const marks = reviewMarks(body.marks);
  if (
    !marks ||
    !reviewerId ||
    !["pass", "issue"].includes(verdict) ||
    !flags.every((flag) =>
      (REVIEW_FLAGS as readonly unknown[]).includes(flag),
    ) ||
    (verdict === "pass" && flags.length > 0) ||
    (verdict === "issue" && flags.length === 0) ||
    note.length > NOTE_LIMIT
  )
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  const entry = sql
    .exec<{ owner_user_id: string | null; preview_revision: string }>(
      "SELECT owner_user_id, preview_revision FROM gallery_entries WHERE id = ? AND status = 'public'",
      entryId,
    )
    .toArray()[0];
  if (!entry) return Response.json({ error: "not-found" }, { status: 404 });
  if (entry.owner_user_id === reviewerId)
    return Response.json({ error: "own-entry" }, { status: 403 });
  if (String(body.revision ?? "") !== entry.preview_revision)
    return Response.json(
      { error: "stale", previewRevision: entry.preview_revision },
      { status: 409 },
    );
  const today = String(body.day ?? "");
  const written = sql
    .exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM entry_reviews WHERE reviewer_id = ? AND created_at >= ?",
      reviewerId,
      today,
    )
    .one().count;
  if (written >= REVIEW_DAILY_LIMIT)
    return Response.json(
      { error: "daily-review-limit", limit: REVIEW_DAILY_LIMIT },
      { status: 429 },
    );
  const row: ReviewRow = {
    id: crypto.randomUUID(),
    entry_id: entryId,
    preview_revision: entry.preview_revision,
    reviewer_id: reviewerId,
    reviewer_name: String(body.reviewerName ?? "").slice(0, 120) || "Reviewer",
    verdict,
    flags: [...new Set(flags as string[])].join(","),
    note,
    marks: marks.length ? JSON.stringify(marks) : "",
    created_at: new Date().toISOString(),
    resolved_at: null,
  };
  sql.exec(
    `INSERT INTO entry_reviews (id, entry_id, preview_revision, reviewer_id,
       reviewer_name, verdict, flags, note, marks, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.entry_id,
    row.preview_revision,
    row.reviewer_id,
    row.reviewer_name,
    row.verdict,
    row.flags,
    row.note,
    row.marks,
    row.created_at,
  );
  return Response.json({ review: shown(row, entry.preview_revision) });
}

/**
 * One entry's reviews. A reviewer sees the others only once their own
 * review of the current version is in (blind review); the Owner always.
 */
export function entryReviews(sql: SqlStorage, body: unknown): Response {
  if (!isRecord(body))
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  const entryId = String(body.entryId ?? "");
  const current = sql
    .exec<{ preview_revision: string }>(
      "SELECT preview_revision FROM gallery_entries WHERE id = ? AND status = 'public'",
      entryId,
    )
    .toArray()[0]?.preview_revision;
  if (current === undefined)
    return Response.json({ error: "not-found" }, { status: 404 });
  const counting = currentReviews(sql, "AND r.entry_id = ?", entryId);
  const mine = counting.find((row) => row.reviewer_id === body.viewerId);
  if (!mine && body.viewerIsOwner !== true)
    return Response.json({ blind: true, revision: current });
  const history = sql
    .exec<ReviewRow>(
      "SELECT * FROM entry_reviews WHERE entry_id = ? ORDER BY created_at DESC",
      entryId,
    )
    .toArray();
  return Response.json({
    blind: false,
    revision: current,
    current: counting.map((row) => shown(row, current)),
    history: history.map((row) => shown(row, current)),
    fixes: entryFixes(sql, entryId),
  });
}

/**
 * The review queue: every entry a reviewer may review (a dataset's: those
 * with a comparison), unreviewed by them first, then those fewest others
 * reviewed. Each carries the reviewer's own latest review and how many
 * reviews count, never anyone else's verdict.
 */
export function reviewQueue(sql: SqlStorage, body: unknown): Response {
  const reviewerId = isRecord(body) ? String(body.reviewerId ?? "") : "";
  const compared = isRecord(body) && body.compared === true;
  const entries = sql
    .exec<{
      id: string;
      name: string;
      author: string;
      preview_revision: string;
      component_count: number;
      verdict: string | null;
      category: string | null;
      detail: string | null;
      reason: string | null;
      figure_revision: string | null;
      reference_revision: string | null;
    }>(
      // A dataset's queue scans its comparisons' card index first (CROSS
      // JOIN keeps the order), never the rows that hold the figures.
      compared
        ? `SELECT e.id, e.name, e.author, e.preview_revision, e.component_count,
             c.verdict, c.category, c.detail, c.reason, c.figure_revision,
             NULL AS reference_revision
           FROM dataset_comparisons c CROSS JOIN gallery_entries e ON e.id = c.id
           WHERE e.status = 'public'
             AND (e.owner_user_id IS NULL OR e.owner_user_id != ?)`
        : `SELECT e.id, e.name, e.author, e.preview_revision, e.component_count,
             NULL AS verdict, NULL AS category, NULL AS detail, NULL AS reason,
             NULL AS figure_revision,
             (SELECT r.revision FROM entry_references r
                INDEXED BY idx_entry_references_revision
              WHERE r.entry_id = e.id) AS reference_revision
           FROM gallery_entries e INDEXED BY idx_gallery_entries_card
           WHERE e.status = 'public'
             AND (e.owner_user_id IS NULL OR e.owner_user_id != ?)`,
      reviewerId,
    )
    .toArray();
  const mine = new Map(
    sql
      .exec<ReviewRow>(
        `SELECT r.* FROM entry_reviews r WHERE r.reviewer_id = ? AND r.created_at = (
           SELECT MAX(created_at) FROM entry_reviews l
           WHERE l.entry_id = r.entry_id AND l.reviewer_id = r.reviewer_id)`,
        reviewerId,
      )
      .toArray()
      .map((row) => [row.entry_id, row]),
  );
  const counts = new Map<string, number>();
  for (const row of currentReviews(sql))
    counts.set(row.entry_id, (counts.get(row.entry_id) ?? 0) + 1);
  const likes = new Map(
    sql
      .exec<{ entry_id: string; count: number }>(
        "SELECT entry_id, SUM(hearts) AS count FROM gallery_likes GROUP BY entry_id",
      )
      .toArray()
      .map((row) => [row.entry_id, row.count]),
  );
  const liked = new Set(
    sql
      .exec<{ entry_id: string }>(
        "SELECT entry_id FROM gallery_likes WHERE user_id = ?",
        reviewerId,
      )
      .toArray()
      .map((row) => row.entry_id),
  );
  const fixers = allFixers(sql);
  const cards = entries.map((entry) => {
    const own = mine.get(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      author: entry.author,
      ...(fixers.has(entry.id) ? { fixedBy: fixers.get(entry.id) } : {}),
      previewRevision: entry.preview_revision,
      components: entry.component_count,
      reviews: counts.get(entry.id) ?? 0,
      likes: likes.get(entry.id) ?? 0,
      likedByViewer: liked.has(entry.id),
      mine: own ? shown(own, entry.preview_revision) : null,
      ...(entry.reference_revision
        ? { reference: { revision: entry.reference_revision } }
        : {}),
      ...(entry.verdict
        ? {
            comparison: {
              verdict: entry.verdict,
              category: entry.category ?? "",
              detail: entry.detail ?? "",
              reason: entry.reason ?? "",
              figureRevision: entry.figure_revision ?? "",
            },
          }
        : {}),
    };
  });
  const done = (card: (typeof cards)[number]) => card.mine?.current === true;
  cards.sort(
    (a, b) =>
      Number(done(a)) - Number(done(b)) ||
      // A drawing with a reference to compare comes before one without.
      Number(!("reference" in a)) - Number(!("reference" in b)) ||
      a.reviews - b.reviews ||
      a.id.localeCompare(b.id, "en", { numeric: true }),
  );
  return Response.json({ entries: cards });
}

/**
 * The Owner's lists: open issues at each entry's current version, and the
 * entries whose current reviews disagree.
 */
export function reviewIssues(sql: SqlStorage): Response {
  const rows = currentReviews(sql);
  const byEntry = new Map<string, ReviewRow[]>();
  for (const row of rows)
    byEntry.set(row.entry_id, [...(byEntry.get(row.entry_id) ?? []), row]);
  return Response.json({
    issues: rows
      .filter((row) => row.verdict === "issue" && row.resolved_at === null)
      .map((row) => shown(row, row.preview_revision)),
    disputed: [...byEntry]
      .filter(
        ([, reviews]) =>
          reviews.some((row) => row.verdict === "pass") &&
          reviews.some(
            (row) => row.verdict === "issue" && row.resolved_at === null,
          ),
      )
      .map(([id]) => id)
      .sort(),
  });
}

/** The Owner marks an issue resolved; the row itself stays. */
export function resolveReview(sql: SqlStorage, body: unknown): Response {
  if (!isRecord(body))
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  const found = sql
    .exec<{ id: string }>(
      "SELECT id FROM entry_reviews WHERE id = ? AND entry_id = ? AND verdict = 'issue'",
      String(body.reviewId ?? ""),
      String(body.entryId ?? ""),
    )
    .toArray()[0];
  if (!found) return Response.json({ error: "not-found" }, { status: 404 });
  sql.exec(
    "UPDATE entry_reviews SET resolved_at = ?, resolved_by = ? WHERE id = ?",
    new Date().toISOString(),
    String(body.resolvedBy ?? ""),
    found.id,
  );
  return Response.json({ ok: true });
}

/**
 * Each person's work in this store: reviews written (passes, issues) and
 * fixes made (how many, of how many circuits, objects changed, issues
 * answered). Every review and fix counts once, current or not.
 */
export function reviewPeople(sql: SqlStorage): Response {
  const people = new Map<
    string,
    {
      name: string;
      reviews: number;
      passes: number;
      issues: number;
      fixes: number;
      circuits: number;
      changes: number;
      addressed: number;
    }
  >();
  const person = (id: string, name: string) => {
    const found = people.get(id) ?? {
      name,
      reviews: 0,
      passes: 0,
      issues: 0,
      fixes: 0,
      circuits: 0,
      changes: 0,
      addressed: 0,
    };
    people.set(id, found);
    return found;
  };
  for (const row of sql
    .exec<{
      reviewer_id: string;
      reviewer_name: string;
      reviews: number;
      passes: number;
      issues: number;
    }>(
      `SELECT reviewer_id, MAX(reviewer_name) AS reviewer_name,
         COUNT(*) AS reviews, SUM(verdict = 'pass') AS passes,
         SUM(verdict = 'issue') AS issues
       FROM entry_reviews GROUP BY reviewer_id`,
    )
    .toArray())
    Object.assign(person(row.reviewer_id, row.reviewer_name), {
      reviews: row.reviews,
      passes: row.passes,
      issues: row.issues,
    });
  for (const row of fixTotals(sql))
    Object.assign(person(row.editor_id, row.editor_name), {
      fixes: row.fixes,
      circuits: row.circuits,
      changes: row.devices + row.wires + row.labels,
      addressed: row.addressed,
    });
  return Response.json({
    people: [...people.values()]
      .sort((a, b) => b.reviews + b.fixes - (a.reviews + a.fixes))
      .map(({ name, ...work }) => ({ person: name, ...work })),
  });
}
