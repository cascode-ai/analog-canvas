import { locallyOwnedResources } from "./resource-ownership";
import { publicationResult } from "./gallery-publication-command";
// The Gallery's simulation checks (#1545): the queue the Owner fills, one
// entry at a time, and each entry's latest verdict. The verdict is a column
// of the entry, private like its testbench; the runs themselves are the
// Worker's (gallery-simulation-checks.ts).

import { sha256Hex } from "@icm/derived";
import {
  SIMULATION_CHECK_RULE_VERSION,
  type SimulationCheck,
  type SimulationCheckFolder,
} from "@icm/simulation-service";
import {
  type DurableObjectStateLike,
  type SqlStorage,
  isRecord,
} from "./gallery-store";
import {
  INLINE_TESTBENCH,
  LEGACY_TESTBENCH,
  testbenchOf,
  withTestbench,
} from "./gallery-testbench";

// The verdict's shape and rule are the simulation service's, shared with
// the Owner's local check (simulation-check.ts there).
export type { SimulationCheck };

interface QueueRow {
  entry_id: string;
  check_id: string;
  queued_at: string;
  requested_by: string;
  content_digest: string | null;
  folder_index: number;
  folders_json: string;
}

interface ContentRow {
  id: string;
  name: string;
  project_text: string;
  testbench_text: string | null;
}

/**
 * The verdict column, the queue, and the trigger that clears a verdict once
 * its entry's Project Code or testbench changes: whatever wrote it (an
 * update, a take-over, a version restore, a maintenance pass), the verdict
 * no longer speaks for what is stored.
 */
export function installSimulationChecks(sql: SqlStorage): void {
  try {
    sql.exec(
      "ALTER TABLE gallery_entries ADD COLUMN simulation_check_json TEXT",
    );
  } catch {
    // Column already present.
  }
  // Rowid order is queue order. Not a backup table: a queue is work, and a
  // restored Gallery is checked again.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS gallery_simulation_checks (
      entry_id TEXT PRIMARY KEY,
      check_id TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      content_digest TEXT,
      folder_index INTEGER NOT NULL DEFAULT 0,
      folders_json TEXT NOT NULL DEFAULT '[]'
    )
  `);
  // The passing verdicts alone, each with its id: the wall narrows and counts
  // by the Sim mark off it (SIMULATION_CHECK_PASSES_INDEXED) instead of
  // reading the verdict at the end of every row, past its Project and SVG.
  sql.exec(`
    CREATE INDEX IF NOT EXISTS idx_gallery_entries_simulation_pass
    ON gallery_entries(id, simulation_check_json)
    WHERE json_extract(simulation_check_json, '$.status') = 'pass'
  `);
  sql.exec(`
    CREATE TRIGGER IF NOT EXISTS gallery_entries_simulation_check_stale
    AFTER UPDATE OF project_text, testbench_text ON gallery_entries
    WHEN OLD.simulation_check_json IS NOT NULL
      AND (NEW.project_text IS NOT OLD.project_text
        OR NEW.testbench_text IS NOT OLD.testbench_text)
    BEGIN
      UPDATE gallery_entries SET simulation_check_json = NULL
      WHERE id = NEW.id;
    END
  `);
}

/** A stored verdict, or null for none or one this build cannot read. */
export function readSimulationCheck(
  text: string | null | undefined,
): SimulationCheck | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return isRecord(value) && typeof value.status === "string"
      ? (value as unknown as SimulationCheck)
      : null;
  } catch {
    return null;
  }
}

/** Whether a stored verdict earns the Sim mark under this build's rule. */
export function simulationCheckPasses(check: SimulationCheck | null): boolean {
  return (
    check?.status === "pass" && check.rule === SIMULATION_CHECK_RULE_VERSION
  );
}

/** The same test in SQL, over an entry row `e`. */
export const SIMULATION_CHECK_PASSES = `(json_extract(e.simulation_check_json, '$.status') = 'pass'
  AND json_extract(e.simulation_check_json, '$.rule') = ${SIMULATION_CHECK_RULE_VERSION})`;

/**
 * The same test off the passing verdicts' index, for the wall's filter and
 * counts: they read the covering wall index alone, never an entry's row.
 */
export const SIMULATION_CHECK_PASSES_INDEXED = `EXISTS (SELECT 1 FROM gallery_entries s
  INDEXED BY idx_gallery_entries_simulation_pass
  WHERE s.id = e.id
    AND json_extract(s.simulation_check_json, '$.status') = 'pass'
    AND json_extract(s.simulation_check_json, '$.rule') = ${SIMULATION_CHECK_RULE_VERSION})`;

/** What a check verifies: the stored Project Code and its testbench. */
function contentDigest(row: ContentRow): string {
  return sha256Hex(`${row.project_text}\u0000${row.testbench_text ?? ""}`);
}

/** An entry's row has a testbench to run, moved out of its Project Code or not. */
const HAS_TESTBENCH = `(testbench_text IS NOT NULL OR ${INLINE_TESTBENCH} OR ${LEGACY_TESTBENCH})`;

/**
 * Queue entries for a check: the ones named, or every public entry with a
 * testbench. An entry already waiting keeps its place; one without a
 * testbench is answered at once, `no-testbench`.
 */
export function queueSimulationChecks(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql;
  const at = String(body.at);
  const requestedBy = String(body.requestedBy);
  const named = Array.isArray(body.ids) ? body.ids.map(String) : [];
  return state.storage.transactionSync(() => {
    const rows =
      body.all === true
        ? sql
            .exec<{ id: string; has_testbench: number }>(
              `SELECT id, 1 AS has_testbench FROM gallery_entries
               WHERE status = 'public' AND ${HAS_TESTBENCH} AND ${locallyOwnedResources(sql)}
               ORDER BY created_at, id`,
            )
            .toArray()
        : named.flatMap((id) =>
            sql
              .exec<{ id: string; has_testbench: number }>(
                `SELECT id, ${HAS_TESTBENCH} AS has_testbench
                 FROM gallery_entries WHERE id = ? AND ${locallyOwnedResources(sql)}`,
                id,
              )
              .toArray(),
          );
    const queued: string[] = [];
    const noTestbench: string[] = [];
    for (const row of rows) {
      if (row.has_testbench) {
        sql.exec(
          `INSERT OR IGNORE INTO gallery_simulation_checks
             (entry_id, check_id, queued_at, requested_by)
           VALUES (?, ?, ?, ?)`,
          row.id,
          crypto.randomUUID(),
          at,
          requestedBy,
        );
        queued.push(row.id);
        continue;
      }
      sql.exec(
        "DELETE FROM gallery_simulation_checks WHERE entry_id = ?",
        row.id,
      );
      sql.exec(
        "UPDATE gallery_entries SET simulation_check_json = ? WHERE id = ?",
        JSON.stringify({
          status: "no-testbench",
          checkedAt: at,
          rule: SIMULATION_CHECK_RULE_VERSION,
          simulator: null,
          reason: "no-testbench",
          folders: [],
        } satisfies SimulationCheck),
        row.id,
      );
      noTestbench.push(row.id);
    }
    const found = new Set(rows.map((row) => row.id));
    return publicationResult({
      queued,
      noTestbench,
      missing: named.filter((id) => !found.has(id)),
      waiting: waitingCount(sql),
    });
  });
}

function waitingCount(sql: SqlStorage): number {
  return sql
    .exec<{
      count: number;
    }>("SELECT COUNT(*) AS count FROM gallery_simulation_checks")
    .one().count;
}

/** Start an entry's check over, under a new id, for content that changed. */
function restartCheck(sql: SqlStorage, entryId: string): void {
  sql.exec(
    `UPDATE gallery_simulation_checks
     SET check_id = ?, content_digest = NULL, folder_index = 0,
         folders_json = '[]'
     WHERE entry_id = ?`,
    crypto.randomUUID(),
    entryId,
  );
}

function contentOf(sql: SqlStorage, id: string): ContentRow | undefined {
  return sql
    .exec<ContentRow>(
      `SELECT id, name, project_text, testbench_text
       FROM gallery_entries WHERE id = ?`,
      id,
    )
    .toArray()[0];
}

/**
 * The check to run next: the queue's first entry, its Project Code with the
 * testbench, the digest of that content, and the folders checked so far.
 * An entry deleted while waiting leaves the queue; one whose content changed
 * mid-check starts over.
 */
export function nextSimulationCheck(state: DurableObjectStateLike): Response {
  const sql = state.storage.sql;
  return state.storage.transactionSync(() => {
    for (;;) {
      const job = sql
        .exec<QueueRow>(
          "SELECT * FROM gallery_simulation_checks ORDER BY rowid LIMIT 1",
        )
        .toArray()[0];
      if (!job) return Response.json({ job: null });
      const row = contentOf(sql, job.entry_id);
      if (!row) {
        sql.exec(
          "DELETE FROM gallery_simulation_checks WHERE entry_id = ?",
          job.entry_id,
        );
        continue;
      }
      const digest = contentDigest(row);
      if (job.content_digest !== null && job.content_digest !== digest) {
        restartCheck(sql, job.entry_id);
        continue;
      }
      return Response.json({
        job: {
          entryId: job.entry_id,
          name: row.name,
          checkId: job.check_id,
          folderIndex: job.folder_index,
          folders: JSON.parse(job.folders_json) as SimulationCheckFolder[],
        },
        digest,
        projectText: withTestbench(row.project_text, row.testbench_text),
      });
    }
  });
}

/**
 * One folder's result, for the check that ran it: the next folder waits,
 * or with `verdict` the entry's check is done and stored. Ignored, with
 * `recorded: false`, when the check moved on or the content changed since
 * (which starts it over).
 */
export function recordSimulationCheck(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql;
  const entryId = String(body.entryId);
  return state.storage.transactionSync(() => {
    const job = sql
      .exec<QueueRow>(
        "SELECT * FROM gallery_simulation_checks WHERE entry_id = ?",
        entryId,
      )
      .toArray()[0];
    if (
      !job ||
      job.check_id !== body.checkId ||
      job.folder_index !== body.folderIndex
    )
      return Response.json({ recorded: false });
    const row = contentOf(sql, entryId);
    if (!row || contentDigest(row) !== body.digest) {
      if (row) restartCheck(sql, entryId);
      return Response.json({ recorded: false });
    }
    if (isRecord(body.verdict)) {
      sql.exec(
        "UPDATE gallery_entries SET simulation_check_json = ? WHERE id = ?",
        JSON.stringify(body.verdict),
        entryId,
      );
      sql.exec(
        "DELETE FROM gallery_simulation_checks WHERE entry_id = ?",
        entryId,
      );
      return Response.json({ recorded: true, done: true });
    }
    sql.exec(
      `UPDATE gallery_simulation_checks
       SET folder_index = ?, folders_json = ?, content_digest = ?
       WHERE entry_id = ?`,
      job.folder_index + 1,
      JSON.stringify([
        ...(JSON.parse(job.folders_json) as unknown[]),
        body.folder,
      ]),
      String(body.digest),
      entryId,
    );
    return Response.json({ recorded: true, done: false });
  });
}

/**
 * The Owner's view of the checks: how many wait, the one running, how the
 * checked entries stand, and the latest verdicts.
 */
export function simulationCheckProgress(
  sql: SqlStorage,
  ownedOnly = false,
): Response {
  const current = sql
    .exec<{ entry_id: string; name: string; folder_index: number }>(
      `SELECT q.entry_id, e.name, q.folder_index
       FROM gallery_simulation_checks q
       JOIN gallery_entries e ON e.id = q.entry_id
       ORDER BY q.rowid LIMIT 1`,
    )
    .toArray()[0];
  // Grouped by the verdict's own status: a bare `status` would name the
  // entry's publication status, putting every verdict in one group.
  const counts = Object.fromEntries(
    sql
      .exec<{ verdict: string; count: number }>(
        `SELECT json_extract(simulation_check_json, '$.status') AS verdict,
           COUNT(*) AS count
         FROM gallery_entries WHERE simulation_check_json IS NOT NULL AND ${ownedOnly ? locallyOwnedResources(sql) : "1=1"}
         GROUP BY verdict`,
      )
      .toArray()
      .map((row) => [row.verdict, Number(row.count)]),
  );
  const results = sql
    .exec<{
      id: string;
      name: string;
      author: string;
      simulation_check_json: string;
    }>(
      `SELECT id, name, author, simulation_check_json FROM gallery_entries
       WHERE simulation_check_json IS NOT NULL AND ${ownedOnly ? locallyOwnedResources(sql) : "1=1"}
       ORDER BY json_extract(simulation_check_json, '$.checkedAt') DESC, id
       LIMIT 100`,
    )
    .toArray()
    .flatMap((row) => {
      const check = readSimulationCheck(row.simulation_check_json);
      return check
        ? [
            {
              id: row.id,
              name: row.name,
              author: row.author,
              status: check.status,
              checkedAt: check.checkedAt,
              ...(check.reason ? { reason: check.reason } : {}),
            },
          ]
        : [];
    });
  return Response.json({
    waiting: waitingCount(sql),
    current: current
      ? {
          id: current.entry_id,
          name: current.name,
          folderIndex: current.folder_index,
        }
      : null,
    counts: {
      pass: counts.pass ?? 0,
      fail: counts.fail ?? 0,
      error: counts.error ?? 0,
      noTestbench: counts["no-testbench"] ?? 0,
    },
    results,
  });
}

/**
 * What a local check speaks for: the stored Project Code and testbench,
 * each by its SHA-256. A testbench still inside the Project Code (a row the
 * privacy pass has not moved) is in both.
 */
function contentDigests(row: ContentRow): {
  projectDigest: string;
  testbenchDigest: string | null;
} {
  const testbench = testbenchOf(row);
  return {
    projectDigest: sha256Hex(row.project_text),
    testbenchDigest: testbench === null ? null : sha256Hex(testbench),
  };
}

/** A row this store writes, or why not: absent, or another region's. */
function writtenRow(
  sql: SqlStorage,
  id: string,
): ContentRow | "not-found" | "wrong-writer" {
  const row = contentOf(sql, id);
  if (!row) return "not-found";
  const owned = sql
    .exec<{ id: string }>(
      `SELECT id FROM gallery_entries WHERE id = ? AND ${locallyOwnedResources(sql)}`,
      id,
    )
    .toArray();
  return owned.length > 0 ? row : "wrong-writer";
}

/** The entries `{all: true}` would queue: every public entry with a testbench. */
export function simulationCheckInputs(sql: SqlStorage): Response {
  return Response.json({
    entries: sql
      .exec<{ id: string; name: string }>(
        `SELECT id, name FROM gallery_entries
         WHERE status = 'public' AND ${HAS_TESTBENCH} AND ${locallyOwnedResources(sql)}
         ORDER BY created_at, id`,
      )
      .toArray()
      .map((row) => ({ id: row.id, name: row.name })),
  });
}

/**
 * One entry for a local check: its Project Code with the testbench, and the
 * digests a recorded verdict must name.
 */
export function simulationCheckInput(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const row = writtenRow(sql, String(body.id));
  if (typeof row === "string")
    return Response.json(
      { error: row },
      { status: row === "wrong-writer" ? 409 : 404 },
    );
  return Response.json({
    id: row.id,
    name: row.name,
    projectText: withTestbench(row.project_text, row.testbench_text),
    ...contentDigests(row),
  });
}

/**
 * Store a verdict the Owner's local check made, for the content it names.
 * Refused, and nothing written, when the entry's Project Code or testbench
 * is no longer what was checked (`stale-content`) or it has no testbench.
 * A recorded verdict ends any hosted check of the entry still waiting.
 */
export function recordLocalSimulationCheck(
  state: DurableObjectStateLike,
  body: Record<string, unknown>,
): Response {
  const sql = state.storage.sql;
  const id = String(body.id);
  return state.storage.transactionSync(() => {
    const row = writtenRow(sql, id);
    if (typeof row === "string")
      return Response.json(
        { error: row },
        { status: row === "wrong-writer" ? 409 : 404 },
      );
    const current = contentDigests(row);
    if (current.testbenchDigest === null)
      return Response.json({ error: "no-testbench" }, { status: 409 });
    if (
      current.projectDigest !== body.projectDigest ||
      current.testbenchDigest !== body.testbenchDigest
    )
      return Response.json({ error: "stale-content" }, { status: 409 });
    if (!isRecord(body.check))
      return Response.json({ error: "invalid-fields" }, { status: 400 });
    sql.exec(
      "UPDATE gallery_entries SET simulation_check_json = ? WHERE id = ?",
      JSON.stringify(body.check),
      id,
    );
    sql.exec("DELETE FROM gallery_simulation_checks WHERE entry_id = ?", id);
    return Response.json({ recorded: true });
  });
}

/** Whether an entry waits in the queue or is being checked. */
export function simulationCheckWaiting(sql: SqlStorage, id: string): boolean {
  return (
    sql
      .exec<{ entry_id: string }>(
        "SELECT entry_id FROM gallery_simulation_checks WHERE entry_id = ?",
        id,
      )
      .toArray().length > 0
  );
}
