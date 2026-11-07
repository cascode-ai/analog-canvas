// Dataset comparisons: each dataset circuit's original figure and the
// verdict of comparing its netlist with our redraw's. A row belongs to an
// entry of the same store and is listed while that entry is public. The
// rows are re-importable derived data, so the backups leave them out.

import { sha256Hex } from "@icm/derived";
import { type SqlStorage, isRecord } from "./gallery-store";

const COMPARISON_VERDICTS = ["match", "notation", "error", "unclear"] as const;
const COMPARISON_FAMILIES = [
  "MOS",
  "BJT",
  "Op-amp",
  "Inductor",
  "Diode",
  "Switch",
] as const;
const COMPARISON_FIGURE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
/** Decoded bytes one figure may hold. */
const COMPARISON_FIGURE_MAX_BYTES = 512 * 1024;
const LIMITS = { category: 60, detail: 160, reason: 1200, netlist: 64 * 1024 };

export function installComparisons(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS dataset_comparisons (
      id TEXT PRIMARY KEY,
      verdict TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      families TEXT NOT NULL DEFAULT '',
      source_netlist TEXT NOT NULL DEFAULT '',
      figure_type TEXT NOT NULL,
      figure_base64 TEXT NOT NULL,
      figure_revision TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) WITHOUT ROWID
  `);
  // The list's fields without the figure. A row's figure sits before its
  // revision, so reading the row for the list walked every figure (about
  // 3 s for AnalogGenie's 1,029). The list scans this index first
  // (CROSS JOIN keeps that order), then each entry by its card index.
  sql.exec(`
    CREATE INDEX IF NOT EXISTS idx_dataset_comparisons_card
    ON dataset_comparisons(id, verdict, category, detail, reason, families,
      figure_revision)
  `);
}

const FIGURE_MAGIC: Record<string, (bytes: Uint8Array) => boolean> = {
  "image/png": (b) =>
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) =>
    String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.subarray(8, 12)) === "WEBP",
};

function decodedFigure(value: unknown): { type: string; data: string } | null {
  if (!isRecord(value)) return null;
  const type = String(value.type ?? "");
  const data = typeof value.data === "string" ? value.data : "";
  if (!(COMPARISON_FIGURE_TYPES as readonly string[]).includes(type) || !data)
    return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes.length > COMPARISON_FIGURE_MAX_BYTES || !FIGURE_MAGIC[type]!(bytes))
    return null;
  return { type, data };
}

function text(value: unknown, limit: number): string | null {
  if (value === undefined || value === null) return "";
  return typeof value === "string" && value.length <= limit
    ? value.trim()
    : null;
}

/** One comparison of an import, checked; the error code when refused. */
export function checkedComparison(
  item: Record<string, unknown>,
): { row: Record<string, unknown> } | { error: string } {
  const verdict = String(item.verdict ?? "");
  const category = text(item.category, LIMITS.category);
  const detail = text(item.detail, LIMITS.detail);
  const reason = text(item.reason, LIMITS.reason);
  const sourceNetlist = text(item.sourceNetlist, LIMITS.netlist);
  const families = item.families ?? [];
  if (
    !(COMPARISON_VERDICTS as readonly string[]).includes(verdict) ||
    category === null ||
    detail === null ||
    reason === null ||
    sourceNetlist === null ||
    (verdict !== "match" && !category) ||
    !Array.isArray(families) ||
    !families.every((family) =>
      (COMPARISON_FAMILIES as readonly unknown[]).includes(family),
    )
  )
    return { error: "invalid-fields" };
  let figure = null;
  if (item.figure !== undefined) {
    figure = decodedFigure(item.figure);
    if (!figure) return { error: "invalid-figure" };
  }
  return {
    row: {
      verdict,
      category: verdict === "match" ? "" : category,
      detail,
      reason,
      families: [...new Set(families as string[])].join(","),
      sourceNetlist,
      figure,
    },
  };
}

/** Insert or replace one checked comparison; a figure left out keeps the stored one. */
export function importComparison(sql: SqlStorage, body: unknown): Response {
  if (!isRecord(body) || typeof body.id !== "string")
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  const row = body as Record<string, unknown> & {
    id: string;
    figure: { type: string; data: string } | null;
  };
  const stored = sql
    .exec<{ figure_type: string; figure_base64: string }>(
      "SELECT figure_type, figure_base64 FROM dataset_comparisons WHERE id = ?",
      row.id,
    )
    .toArray()[0];
  const figure =
    row.figure ??
    (stored ? { type: stored.figure_type, data: stored.figure_base64 } : null);
  if (!figure)
    return Response.json({ error: "figure-required" }, { status: 422 });
  sql.exec(
    `INSERT OR REPLACE INTO dataset_comparisons
       (id, verdict, category, detail, reason, families, source_netlist,
        figure_type, figure_base64, figure_revision, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    String(row.verdict),
    String(row.category),
    String(row.detail),
    String(row.reason),
    String(row.families),
    String(row.sourceNetlist),
    figure.type,
    figure.data,
    sha256Hex(`${figure.type}\u0000${figure.data}`).slice(0, 16),
    new Date().toISOString(),
  );
  return Response.json({ ok: true, created: !stored });
}

/** Every comparison whose entry is public, with the entry's card fields. */
export function listComparisons(sql: SqlStorage): Response {
  const rows = sql
    .exec<{
      id: string;
      name: string;
      verdict: string;
      category: string;
      detail: string;
      reason: string;
      families: string;
      component_count: number;
      preview_revision: string;
      figure_revision: string;
    }>(
      `SELECT c.id, e.name, c.verdict, c.category, c.detail, c.reason,
         c.families, e.component_count, e.preview_revision, c.figure_revision
       FROM dataset_comparisons c CROSS JOIN gallery_entries e ON e.id = c.id
       WHERE e.status = 'public' ORDER BY c.id`,
    )
    .toArray();
  return Response.json({
    comparisons: rows.map((row) => ({
      id: row.id,
      name: row.name,
      verdict: row.verdict,
      category: row.category,
      detail: row.detail,
      reason: row.reason,
      families: row.families ? row.families.split(",") : [],
      components: row.component_count,
      previewRevision: row.preview_revision,
      figureRevision: row.figure_revision,
    })),
  });
}

/** How many comparisons the list shows. */
export function comparisonCount(sql: SqlStorage): number {
  return sql
    .exec<{ count: number }>(
      `SELECT COUNT(*) AS count FROM dataset_comparisons c
       CROSS JOIN gallery_entries e ON e.id = c.id WHERE e.status = 'public'`,
    )
    .one().count;
}

/** One listed comparison's dataset netlist, or its figure. */
export function comparisonPart(
  sql: SqlStorage,
  body: unknown,
  part: "netlist" | "figure",
): Response {
  const id = isRecord(body) ? String(body.id ?? "") : "";
  const row = sql
    .exec<{
      source_netlist: string;
      figure_type: string;
      figure_base64: string;
      figure_revision: string;
    }>(
      `SELECT c.source_netlist, c.figure_type, c.figure_base64, c.figure_revision
       FROM dataset_comparisons c JOIN gallery_entries e ON e.id = c.id
       WHERE c.id = ? AND e.status = 'public'`,
      id,
    )
    .toArray()[0];
  if (!row) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json(
    part === "netlist"
      ? { id, sourceNetlist: row.source_netlist }
      : {
          type: row.figure_type,
          data: row.figure_base64,
          revision: row.figure_revision,
        },
  );
}
