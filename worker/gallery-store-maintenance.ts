// Maintenance passes over stored entries: Project format and schema
// convergence, netlist marks and part counts, label looks, moving testbenches
// out of the Project Code, and the pages of the netlist read.

import {
  COMPONENT_COUNT_RULE_VERSION,
  galleryComponentCount,
} from "./gallery-components";
import { sha256Hex } from "@icm/derived";
import { designExtractsNetlist, NETLIST_MARK_RULE_VERSION } from "@icm/netlist";
import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
  upgradeSchema24To25,
  upgradeSchema25To26,
  upgradeSchema26To27,
  upgradeSchema27To28,
  upgradeSchema28To29WithReport,
  upgradeSchema29To30WithReport,
  upgradeSchema30To31WithReport,
  upgradeSchema31To32WithReport,
  upgradeSchema32To33WithReport,
  upgradeSchema33To34WithReport,
  upgradeSchema34To35WithReport,
  upgradeSchema35To36WithReport,
  upgradeSchema36To37WithReport,
  upgradeSchema37To38WithReport,
  upgradeSchema38To39WithReport,
  upgradeSchema39To40WithReport,
  upgradeSchema40To41WithReport,
  upgradeSchema41To42WithReport,
  upgradeSchema42To43WithReport,
  upgradeSchema43To44WithReport,
  upgradeSchema44To45WithReport,
  upgradeSchema45To46WithReport,
  upgradeSchema46To47WithReport,
} from "@icm/project-protocol";
import {
  type DurableObjectStateLike,
  type EntryRow,
  GALLERY_MAX_PROJECT_BYTES,
  type SqlStorage,
  advanceCurationRevision,
  svgPreviewDimensions,
  unwrapTags,
} from "./gallery-store";
import {
  INLINE_TESTBENCH,
  LEGACY_TESTBENCH,
  splitTestbench,
  withTestbench,
} from "./gallery-testbench";

interface StoredProjectRow {
  id: string;
  schema_version: number;
  project_text: string;
}

/** Entries per netlist page, and the Project Code characters one may carry. */
const GALLERY_NETLIST_PAGE_LIMIT = 100;
const GALLERY_NETLIST_MAX_PAGE_LIMIT = 200;
export const GALLERY_NETLIST_PAGE_CHARACTERS = 8_000_000;

/**
 * Validate every persisted Project before writing any of them. The apply
 * phase is one Durable Object transaction, so a failed record cannot leave
 * the three storage surfaces at mixed schema versions.
 */
/** Bounded Gallery-only conversion. Never touch history retention or row metadata. */
export function galleryProjectFormat(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const tables = {
    galleryEntries: "gallery_entries",
    galleryEntryVersions: "gallery_entry_versions",
  } as const;
  if (
    typeof body.table !== "string" ||
    !Object.hasOwn(tables, body.table) ||
    typeof body.id !== "string" ||
    !body.id ||
    typeof body.originalProjectText !== "string" ||
    typeof body.projectText !== "string" ||
    Object.keys(body).some(
      (key) =>
        !["table", "id", "originalProjectText", "projectText"].includes(key),
    ) ||
    new TextEncoder().encode(body.projectText).length >
      GALLERY_MAX_PROJECT_BYTES ||
    new TextEncoder().encode(body.originalProjectText).length >
      GALLERY_MAX_PROJECT_BYTES
  )
    return Response.json({ error: "invalid-request" }, { status: 400 });
  const table = tables[body.table as keyof typeof tables];
  const row = sql
    .exec<StoredProjectRow>(
      `SELECT id, schema_version, project_text FROM ${table} WHERE id = ?`,
      body.id,
    )
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  if (
    row.project_text === body.projectText &&
    row.schema_version === CURRENT_PROJECT_FILE_VERSION
  )
    return Response.json({
      id: row.id,
      changed: false,
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    });
  if (row.project_text !== body.originalProjectText)
    return Response.json(
      { error: "concurrent-change", id: row.id },
      { status: 409 },
    );
  try {
    // Independently reproduce the offline conversion. Clients cannot use this
    // maintenance operation to alter circuit content or submit arbitrary JSON.
    const expected = serializeProject(parseProject(row.project_text));
    if (
      expected !== body.projectText ||
      serializeProject(parseProject(expected)) !== expected
    )
      return Response.json({ error: "conversion-mismatch" }, { status: 422 });
  } catch (error) {
    return Response.json(
      {
        error: "invalid-project",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 422 },
    );
  }
  // Synchronous DO operation: no await between compare and update. The SQL
  // predicate also protects against future refactors introducing an await.
  sql.exec(
    `UPDATE ${table} SET project_text = ?, schema_version = ? WHERE id = ? AND project_text = ?`,
    body.projectText,
    CURRENT_PROJECT_FILE_VERSION,
    body.id,
    body.originalProjectText,
  );
  testbenchesMayBeInline(sql);
  return Response.json({
    id: row.id,
    changed: true,
    schemaVersion: CURRENT_PROJECT_FILE_VERSION,
  });
}

export function schemaConverge(
  state: DurableObjectStateLike,
  apply: boolean,
): Response {
  const sql = state.storage.sql;
  const sources = [
    {
      table: "gallery_entries",
      rows: sql
        .exec<StoredProjectRow>(
          "SELECT id, schema_version, project_text FROM gallery_entries",
        )
        .toArray(),
    },
    {
      table: "gallery_entry_versions",
      rows: sql
        .exec<StoredProjectRow>(
          "SELECT id, schema_version, project_text FROM gallery_entry_versions",
        )
        .toArray(),
    },
    {
      table: "cloud_projects",
      rows: sql
        .exec<StoredProjectRow>(
          "SELECT id, schema_version, project_text FROM cloud_projects",
        )
        .toArray(),
    },
    {
      table: "cloud_project_versions",
      rows: sql
        .exec<StoredProjectRow>(
          "SELECT id, schema_version, project_text FROM cloud_project_versions",
        )
        .toArray(),
    },
  ] as const;
  const inventory: Record<string, Record<string, number>> = {};
  const updates: Array<{
    table: (typeof sources)[number]["table"];
    id: string;
    projectText: string;
  }> = [];
  const failures: Array<{
    table: string;
    id: string;
    storedSchemaVersion: number;
    message: string;
  }> = [];
  const migrationReports: Array<{
    table: string;
    id: string;
    report:
      | ReturnType<typeof upgradeSchema28To29WithReport>["report"]
      | ReturnType<typeof upgradeSchema29To30WithReport>["report"]
      | ReturnType<typeof upgradeSchema30To31WithReport>["report"]
      | ReturnType<typeof upgradeSchema31To32WithReport>["report"]
      | ReturnType<typeof upgradeSchema32To33WithReport>["report"]
      | ReturnType<typeof upgradeSchema33To34WithReport>["report"]
      | ReturnType<typeof upgradeSchema34To35WithReport>["report"]
      | ReturnType<typeof upgradeSchema35To36WithReport>["report"]
      | ReturnType<typeof upgradeSchema36To37WithReport>["report"]
      | ReturnType<typeof upgradeSchema37To38WithReport>["report"]
      | ReturnType<typeof upgradeSchema38To39WithReport>["report"]
      | ReturnType<typeof upgradeSchema39To40WithReport>["report"]
      | ReturnType<typeof upgradeSchema40To41WithReport>["report"]
      | ReturnType<typeof upgradeSchema41To42WithReport>["report"]
      | ReturnType<typeof upgradeSchema42To43WithReport>["report"]
      | ReturnType<typeof upgradeSchema43To44WithReport>["report"]
      | ReturnType<typeof upgradeSchema44To45WithReport>["report"]
      | ReturnType<typeof upgradeSchema45To46WithReport>["report"]
      | ReturnType<typeof upgradeSchema46To47WithReport>["report"];
  }> = [];
  for (const source of sources) {
    const versions: Record<string, number> = {};
    inventory[source.table] = versions;
    for (const row of source.rows) {
      const versionKey = String(row.schema_version);
      versions[versionKey] = (versions[versionKey] ?? 0) + 1;
      try {
        const raw = JSON.parse(row.project_text) as Record<string, unknown>;
        // Rows can lag more than one version between converge runs; chain
        // every retained adapter link by link before crossing the rolling
        // project-file boundary.
        let lifted = raw;
        if (lifted.schemaVersion === 24) {
          lifted = upgradeSchema24To25(lifted);
        }
        if (lifted.schemaVersion === 25) {
          lifted = upgradeSchema25To26(lifted);
        }
        if (lifted.schemaVersion === 26) {
          lifted = upgradeSchema26To27(lifted);
        }
        if (lifted.schemaVersion === 27) {
          lifted = upgradeSchema27To28(lifted);
        }
        if (lifted.schemaVersion === 28) {
          const migration = upgradeSchema28To29WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 29) {
          const migration = upgradeSchema29To30WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 30) {
          const migration = upgradeSchema30To31WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 31) {
          const migration = upgradeSchema31To32WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 32) {
          const migration = upgradeSchema32To33WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 33) {
          const migration = upgradeSchema33To34WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 34) {
          const migration = upgradeSchema34To35WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 35) {
          const migration = upgradeSchema35To36WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 36) {
          const migration = upgradeSchema36To37WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 37) {
          const migration = upgradeSchema37To38WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 38) {
          const migration = upgradeSchema38To39WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 39) {
          const migration = upgradeSchema39To40WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 40) {
          const migration = upgradeSchema40To41WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 41) {
          const migration = upgradeSchema41To42WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 42) {
          const migration = upgradeSchema42To43WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 43) {
          const migration = upgradeSchema43To44WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 44) {
          const migration = upgradeSchema44To45WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 45) {
          const migration = upgradeSchema45To46WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        if (lifted.schemaVersion === 46) {
          const migration = upgradeSchema46To47WithReport(lifted);
          lifted = migration.project;
          migrationReports.push({
            table: source.table,
            id: row.id,
            report: migration.report,
          });
        }
        const project = parseProject(JSON.stringify(lifted));
        updates.push({
          table: source.table,
          id: row.id,
          projectText: serializeProject(project),
        });
      } catch (error) {
        failures.push({
          table: source.table,
          id: row.id,
          storedSchemaVersion: row.schema_version,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  if (apply && failures.length > 0) {
    return Response.json(
      {
        applied: false,
        targetSchemaVersion: CURRENT_PROJECT_FILE_VERSION,
        inventory,
        failures,
      },
      { status: 409 },
    );
  }
  if (apply) {
    state.storage.transactionSync(() => {
      for (const update of updates) {
        sql.exec(
          `UPDATE ${update.table}
           SET project_text = ?, schema_version = ? WHERE id = ?`,
          update.projectText,
          CURRENT_PROJECT_FILE_VERSION,
          update.id,
        );
      }
      testbenchesMayBeInline(sql);
    });
  }
  return Response.json({
    applied: apply,
    targetSchemaVersion: CURRENT_PROJECT_FILE_VERSION,
    inventory,
    records: updates.length + failures.length,
    ready: updates.length,
    failures,
    migrationReports,
  });
}

/**
 * Re-answer the netlist badge for stored entries.
 *
 * The badge is written when a circuit is published, republished or
 * restored, so it follows every edit from here on. Entries published before
 * the current answer existed keep a stale one, and only a pass over stored
 * Projects can correct that. The pass is batched and resumable: one call
 * scans `limit` entries after `after`, reports what is left, and never
 * holds the Object for the whole Gallery.
 */
/**
 * Re-answer the marks this build's rule has not answered yet.
 *
 * Entries carry the rule version their mark came from, so a deployed rule
 * change leaves exactly the stale rows to find and nothing else to
 * remember: no cursor to carry, no pass to repeat over answers that are
 * already current, and the same work whether a person presses the button
 * or the schedule comes round.
 */
export function refreshNetlistable(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
  // The part count is the same kind of answer about the drawing, kept
  // current by the same pass.
  const stale = `netlistable_version < ? OR component_count_version < ?`;
  const rows = sql
    .exec<{
      id: string;
      project_text: string;
      netlistable: number;
      component_count: number;
    }>(
      `SELECT id, project_text, netlistable, component_count
       FROM gallery_entries WHERE ${stale} ORDER BY id LIMIT ?`,
      NETLIST_MARK_RULE_VERSION,
      COMPONENT_COUNT_RULE_VERSION,
      limit,
    )
    .toArray();
  let changed = 0;
  let unreadable = 0;
  for (const row of rows) {
    let answer: number;
    let parts: number;
    try {
      const project = parseProject(row.project_text);
      answer = designExtractsNetlist(project) ? 1 : 0;
      parts = galleryComponentCount(project);
    } catch {
      // A Project this build cannot parse keeps the answer it has; the
      // schema maintenance pass owns that repair. Stamping it anyway stops
      // the pass from meeting the same unreadable row for ever.
      unreadable += 1;
      sql.exec(
        `UPDATE gallery_entries
         SET netlistable_version = ?, component_count_version = ?
         WHERE id = ?`,
        NETLIST_MARK_RULE_VERSION,
        COMPONENT_COUNT_RULE_VERSION,
        row.id,
      );
      continue;
    }
    if (answer !== row.netlistable || parts !== row.component_count)
      changed += 1;
    sql.exec(
      `UPDATE gallery_entries SET netlistable = ?, netlistable_version = ?,
         component_count = ?, component_count_version = ?
       WHERE id = ?`,
      answer,
      NETLIST_MARK_RULE_VERSION,
      parts,
      COMPONENT_COUNT_RULE_VERSION,
      row.id,
    );
  }
  const remaining = Number(
    sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM gallery_entries WHERE ${stale}`,
        NETLIST_MARK_RULE_VERSION,
        COMPONENT_COUNT_RULE_VERSION,
      )
      .one().count,
  );
  return Response.json({
    scanned: rows.length,
    changed,
    unreadable,
    ruleVersion: NETLIST_MARK_RULE_VERSION,
    remaining,
  });
}

/** Recorded once a pass finds no testbench left inside stored Project Code. */
const TESTBENCHES_MOVED = "2026-10-09-testbench-privacy";
/** Each backup the Owner recorded for the move: this prefix and its Release. */
const TESTBENCH_BACKUP = "2026-10-09-testbench-privacy-backup:";
/** Rows one pass moves unless asked for another number. */
const TESTBENCH_BATCH = 25;

/**
 * A write that can leave a testbench inside stored Project Code again (a
 * restore, a schema conversion) asks the scheduled pass to look again.
 */
export function testbenchesMayBeInline(sql: SqlStorage): void {
  sql.exec("DELETE FROM data_migrations WHERE id = ?", TESTBENCHES_MOVED);
}

/**
 * One row's Project Code without its testbench, checked: the text round-
 * trips byte for byte, and as JSON nothing but the testbench changed.
 */
function movedTestbench(
  projectText: string,
): { projectText: string; testbench: string } | string {
  const split = splitTestbench(projectText);
  if (!split?.testbench) return "no testbench to move";
  if (withTestbench(split.projectText, split.testbench) !== projectText)
    return "the split does not restore the stored text";
  try {
    const before = JSON.parse(projectText) as Record<string, unknown>;
    if (
      JSON.stringify({ ...before, [split.key]: [] }) !==
      JSON.stringify(JSON.parse(split.projectText))
    )
      return "the split changes more than the testbench";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return { projectText: split.projectText, testbench: split.testbench };
}

/**
 * Move every entry's and saved version's testbench out of its stored Project
 * Code into its private column (#1545), `limit` rows a call. Every other byte
 * of the Project Code stays; nothing else of the row changes, and no version
 * is snapshotted (the content is the same). It moves nothing until the Owner
 * has recorded a backup taken first (`backup`, the backup Release's name):
 * the backups run in the private backup repository, which the Worker cannot
 * start. `scheduled` is the five-minute pass, which returns at once while
 * there is no backup or nothing left to move. Rows from before schema 42 are
 * counted as `legacy`: `schema-current` converts them, then this moves them.
 */
export function moveStoredTestbenches(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  if (typeof body.backup === "string")
    sql.exec(
      "INSERT OR IGNORE INTO data_migrations(id, applied_at) VALUES (?, ?)",
      `${TESTBENCH_BACKUP}${body.backup}`,
      String(body.at),
    );
  const backup =
    sql
      .exec<{ id: string }>(
        `SELECT id FROM data_migrations WHERE substr(id, 1, ?) = ?
         ORDER BY applied_at DESC LIMIT 1`,
        TESTBENCH_BACKUP.length,
        TESTBENCH_BACKUP,
      )
      .toArray()[0]
      ?.id.slice(TESTBENCH_BACKUP.length) ?? null;
  const done =
    sql
      .exec("SELECT 1 FROM data_migrations WHERE id = ?", TESTBENCHES_MOVED)
      .toArray().length > 0;
  if (body.scheduled === true && (done || !backup))
    return Response.json({ skipped: done ? "moved" : "backup-required" });
  const apply = body.apply === true;
  if (apply && !backup)
    return Response.json(
      {
        error: "backup-required",
        message:
          "Take a backup first: run `node scripts/gallery-private-snapshot.mjs --store` and send the Release it downloads (store-<time>Z-<run>-<attempt>) as `backup`.",
      },
      { status: 409 },
    );
  const tables = {
    galleryEntries: "gallery_entries",
    galleryEntryVersions: "gallery_entry_versions",
  } as const;
  const moved = { galleryEntries: 0, galleryEntryVersions: 0 };
  const failures: { table: string; id: string; message: string }[] = [];
  let budget = apply
    ? Math.min(
        Math.max(Math.trunc(Number(body.limit)) || TESTBENCH_BATCH, 1),
        200,
      )
    : 0;
  for (const [name, table] of Object.entries(tables) as [
    keyof typeof tables,
    string,
  ][]) {
    // One row at a time, in id order: a Project Code may be 2 MiB, and a row
    // that fails stays behind without holding up the rest.
    let after = "";
    while (budget > 0) {
      const row = sql
        .exec<{ id: string; project_text: string }>(
          `SELECT id, project_text FROM ${table}
           WHERE ${INLINE_TESTBENCH} AND id > ? ORDER BY id LIMIT 1`,
          after,
        )
        .toArray()[0];
      if (!row) break;
      after = row.id;
      const result = movedTestbench(row.project_text);
      if (typeof result === "string") {
        failures.push({ table: name, id: row.id, message: result });
        continue;
      }
      sql.exec(
        `UPDATE ${table} SET project_text = ?, testbench_text = ? WHERE id = ?`,
        result.projectText,
        result.testbench,
        row.id,
      );
      moved[name] += 1;
      budget -= 1;
    }
  }
  const count = (table: string, where: string) =>
    Number(
      sql
        .exec<{ count: number }>(
          `SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`,
        )
        .one().count,
    );
  const remaining = {
    galleryEntries: count(tables.galleryEntries, INLINE_TESTBENCH),
    galleryEntryVersions: count(tables.galleryEntryVersions, INLINE_TESTBENCH),
  };
  if (remaining.galleryEntries + remaining.galleryEntryVersions === 0)
    sql.exec(
      "INSERT OR IGNORE INTO data_migrations(id, applied_at) VALUES (?, ?)",
      TESTBENCHES_MOVED,
      String(body.at),
    );
  return Response.json({
    backup,
    applied: apply,
    moved,
    remaining,
    legacy: {
      galleryEntries: count(tables.galleryEntries, LEGACY_TESTBENCH),
      galleryEntryVersions: count(
        tables.galleryEntryVersions,
        LEGACY_TESTBENCH,
      ),
    },
    failures,
  });
}

export function allIds(sql: SqlStorage): Response {
  const rows = sql
    .exec<{ id: string }>("SELECT id FROM gallery_entries ORDER BY id")
    .toArray();
  return Response.json({ ids: rows.map((row) => row.id) });
}

/** The one Gallery row a label-look maintenance pass reads. */
export function labelLooksRead(
  sql: SqlStorage,
  id: string,
  table: unknown,
): Response {
  // `savedAt` is when the content was last saved by its author: a version
  // holds content from before its own date; an entry's content is from its
  // creation or its newest update, which left a version behind.
  if (table === "galleryEntryVersions") {
    const version = sql
      .exec<{
        project_text: string;
        created_at: string;
        entry_id: string;
        status: string | null;
      }>(
        `SELECT v.project_text, v.created_at, v.entry_id, e.status
         FROM gallery_entry_versions v
         LEFT JOIN gallery_entries e ON e.id = v.entry_id
         WHERE v.id = ?`,
        id,
      )
      .toArray()[0];
    if (!version) return Response.json({ error: "not-found" }, { status: 404 });
    // A version answers with its entry's status: history follows its entry.
    return Response.json({
      status: version.status,
      entryId: version.entry_id,
      projectText: version.project_text,
      savedAt: version.created_at,
    });
  }
  const row = sql
    .exec<{ status: string; project_text: string; created_at: string }>(
      "SELECT status, project_text, created_at FROM gallery_entries WHERE id = ?",
      id,
    )
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  const updated = sql
    .exec<{ at: string | null }>(
      "SELECT MAX(created_at) AS at FROM gallery_entry_versions WHERE entry_id = ?",
      id,
    )
    .one().at;
  return Response.json({
    status: row.status,
    projectText: row.project_text,
    savedAt: updated && updated > row.created_at ? updated : row.created_at,
  });
}

/**
 * One page of public entries' Project Code, in id order, for the netlist
 * read. A page ends at `limit` entries or once its Project Code passes the
 * size budget, so one response stays well inside a Worker's memory however
 * large the drawings are. Sizes are read first and the page's text second,
 * by id range, so the rows past the budget are never loaded.
 */
export function netlistSources(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const limit = Math.min(
    Math.max(Math.trunc(Number(body.limit)) || GALLERY_NETLIST_PAGE_LIMIT, 1),
    GALLERY_NETLIST_MAX_PAGE_LIMIT,
  );
  const id = typeof body.id === "string" && body.id ? body.id : null;
  const sizes = sql
    .exec<{ id: string; size: number }>(
      `SELECT id, LENGTH(project_text) AS size FROM gallery_entries
       WHERE status = 'public' AND id ${id ? "=" : ">"} ?
       ORDER BY id LIMIT ?`,
      id ?? (typeof body.after === "string" ? body.after : ""),
      limit + 1,
    )
    .toArray();
  let count = 0;
  let characters = 0;
  while (
    count < Math.min(limit, sizes.length) &&
    (count === 0 ||
      characters + sizes[count]!.size <= GALLERY_NETLIST_PAGE_CHARACTERS)
  ) {
    characters += sizes[count]!.size;
    count += 1;
  }
  const last = sizes[count - 1]?.id;
  const rows =
    last === undefined
      ? []
      : sql
          .exec<{
            id: string;
            name: string;
            author: string;
            tags: string | null;
            created_at: string;
            netlistable: number;
            project_text: string;
          }>(
            `SELECT id, name, author, tags, created_at, netlistable,
               project_text
             FROM gallery_entries
             WHERE status = 'public' AND id >= ? AND id <= ? ORDER BY id`,
            sizes[0]!.id,
            last,
          )
          .toArray();
  return Response.json({
    entries: rows.map((row) => ({
      id: row.id,
      name: row.name,
      author: row.author,
      tags: unwrapTags(row.tags),
      createdAt: row.created_at,
      netlistable: row.netlistable === 1,
      projectText: row.project_text,
    })),
    nextCursor: count < sizes.length ? last : null,
  });
}

/**
 * Store one server-verified label-look change: the Project and its
 * re-rendered preview, only if the row still holds exactly the Project
 * that was checked. History, byline, status, tags and likes are untouched.
 */
export function labelLooksStore(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  if (body.table === "galleryEntryVersions")
    return labelLooksStoreVersion(sql, body);
  const row = sql
    .exec<EntryRow>(
      "SELECT * FROM gallery_entries WHERE id = ?",
      String(body.id),
    )
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  if (row.project_text !== String(body.originalProjectText))
    return Response.json(
      { error: "concurrent-change", id: row.id },
      { status: 409 },
    );
  const svgText = String(body.svgText);
  const previewRevision = sha256Hex(svgText);
  const previewDimensions = svgPreviewDimensions(svgText);
  // Synchronous DO operation: no await between compare and update. The SQL
  // predicate also protects against future refactors introducing an await.
  sql.exec(
    `UPDATE gallery_entries
     SET project_text = ?, schema_version = ?, svg_text = ?,
         preview_revision = ?, preview_width = ?, preview_height = ?,
         curation_json = ?
     WHERE id = ? AND project_text = ?`,
    String(body.projectText),
    Number(body.schemaVersion),
    svgText,
    previewRevision,
    previewDimensions?.width ?? null,
    previewDimensions?.height ?? null,
    advanceCurationRevision(row, String(body.at ?? row.created_at)),
    row.id,
    row.project_text,
  );
  return Response.json({ id: row.id, previewRevision });
}

/**
 * The same verified change to a retained version: its Project and preview
 * only, if it still holds exactly the Project that was checked. Its id,
 * entry, number, byline, text, tags and date stay as they were.
 */
function labelLooksStoreVersion(
  sql: SqlStorage,
  body: Record<string, unknown>,
): Response {
  const version = sql
    .exec<{ id: string; project_text: string }>(
      "SELECT id, project_text FROM gallery_entry_versions WHERE id = ?",
      String(body.id),
    )
    .toArray()[0];
  if (!version) return Response.json({ error: "not-found" }, { status: 404 });
  if (version.project_text !== String(body.originalProjectText))
    return Response.json(
      { error: "concurrent-change", id: version.id },
      { status: 409 },
    );
  const svgText = String(body.svgText);
  sql.exec(
    `UPDATE gallery_entry_versions
     SET project_text = ?, schema_version = ?, svg_text = ?
     WHERE id = ? AND project_text = ?`,
    String(body.projectText),
    Number(body.schemaVersion),
    svgText,
    version.id,
    version.project_text,
  );
  return Response.json({
    id: version.id,
    previewRevision: sha256Hex(svgText),
  });
}
