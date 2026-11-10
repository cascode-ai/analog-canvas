import {
  AnalyticsSyncError,
  ANALYTICS_SYNC_RETENTION_DAYS,
} from "./replication";
import type { SqlStorage } from "./worker";

type Row = Record<string, string | number | null>;

function valid(condition: unknown): asserts condition {
  if (!condition)
    throw new AnalyticsSyncError("baseline-requires-reconciliation");
}

function count(value: unknown): number {
  valid(Number.isSafeInteger(value) && Number(value) >= 0);
  return Number(value);
}

/** One-time legacy import: refuse attribution that the old aggregates lost. */
export function seedLegacyAnalytics(
  sql: SqlStorage,
  input: unknown,
  maxBucket: number,
  minimumDay: number,
): void {
  const snapshot = input as { format: string; tables: Record<string, Row[]> };
  valid(snapshot?.format === "canvas-analytics-backup-v1" && snapshot.tables);
  const rows = (name: string): Row[] => {
    const result = snapshot.tables[name];
    valid(
      Array.isArray(result) &&
        result.every((row) => row && typeof row === "object"),
    );
    return result;
  };
  const visitors = rows("visitors"),
    days = rows("daily_views"),
    daily = rows("daily_visitors");
  // The current China baseline has one browser on one day. For multiple
  // browsers, source/path attribution cannot be reconstructed from aggregates.
  valid(visitors.length <= 1 && days.length <= 1 && daily.length <= 1);
  valid(rows("daily_visitor_counts").length === 0);
  const total = rows("analytics_meta").find(
    (row) => row.key === "visitor_total",
  )?.value;
  valid(typeof total === "string" && Number(total) === visitors.length);
  const pv = days.length ? count(days[0]!.views) : 0;
  valid(pv > 0 === (visitors.length === 1) && daily.length === visitors.length);
  let newVisitor = 0,
    day = 0,
    source: string | null = null;
  if (pv) {
    const visitor = visitors[0]!,
      visit = daily[0]!;
    valid(
      typeof visitor.visitor_hash === "string" &&
        /^[a-f0-9]{64}$/.test(visitor.visitor_hash),
    );
    day = count(days[0]!.day);
    valid(
      day >=
        Math.max(
          Math.floor(Date.now() / 86_400_000) -
            (ANALYTICS_SYNC_RETENTION_DAYS - 1),
          minimumDay,
        ) && day <= Math.floor(Date.now() / 86_400_000),
    );
    valid(
      visit.day === day &&
        visitor.last_seen_day === day &&
        visit.visitor_hash === visitor.visitor_hash &&
        typeof visit.source === "string",
    );
    newVisitor = sql
      .exec(
        "SELECT visitor_hash FROM visitors WHERE visitor_hash=?",
        visitor.visitor_hash,
      )
      .toArray().length
      ? 0
      : 1;
    source =
      sql
        .exec<{ source: string | null }>(
          "SELECT source FROM daily_visitors WHERE day=? AND visitor_hash=?",
          day,
          visitor.visitor_hash,
        )
        .toArray()[0]?.source ?? visit.source;
    sql.exec(
      "INSERT INTO daily_views VALUES (?,?) ON CONFLICT(day) DO UPDATE SET views=views+excluded.views",
      day,
      pv,
    );
    sql.exec(
      "INSERT INTO visitors VALUES (?,?) ON CONFLICT(visitor_hash) DO UPDATE SET last_seen_day=MAX(last_seen_day,excluded.last_seen_day)",
      visitor.visitor_hash,
      day,
    );
    sql.exec(
      "INSERT OR IGNORE INTO daily_visitors(day,visitor_hash,source) VALUES (?,?,?)",
      day,
      visitor.visitor_hash,
      source,
    );
    sql.exec(
      "UPDATE analytics_meta SET value=CAST(value AS INTEGER)+? WHERE key='visitor_total'",
      newVisitor,
    );
  }
  for (const table of [
    "analytics_countries",
    "analytics_sources",
    "analytics_pages",
  ]) {
    const breakdown = rows(table);
    valid(breakdown.reduce((sum, row) => sum + count(row.pv), 0) === pv);
    valid(
      breakdown.reduce((sum, row) => sum + count(row.uv), 0) ===
        visitors.length,
    );
    if (table === "analytics_sources" && pv) {
      sql.exec(
        "INSERT INTO analytics_sources VALUES (?,?,?) ON CONFLICT(dimension_key) DO UPDATE SET pv=pv+excluded.pv,uv=uv+excluded.uv",
        source,
        pv,
        newVisitor,
      );
      continue;
    }
    for (const row of breakdown) {
      valid(
        typeof row.dimension_key === "string" &&
          row.dimension_key.length <= 256,
      );
      sql.exec(
        `INSERT INTO ${table} VALUES (?,?,?) ON CONFLICT(dimension_key) DO UPDATE SET pv=pv+excluded.pv,uv=uv+excluded.uv`,
        row.dimension_key,
        count(row.pv),
        newVisitor ? count(row.uv) : 0,
      );
    }
  }
  for (const row of rows("analytics_points")) {
    valid(
      Number.isInteger(row.lat) &&
        Number.isInteger(row.lng) &&
        Math.abs(Number(row.lat)) <= 90 &&
        Math.abs(Number(row.lng)) <= 180,
    );
    sql.exec(
      "INSERT INTO analytics_points VALUES (?,?,?) ON CONFLICT(lat,lng) DO UPDATE SET count=count+excluded.count",
      row.lat,
      row.lng,
      count(row.count),
    );
  }
  for (const row of rows("load_times")) {
    valid(row.metric === "ttfb" || row.metric === "shown");
    valid(typeof row.country === "string" && /^[A-Z0-9]{2}$/.test(row.country));
    const bucket = count(row.bucket);
    valid(bucket <= maxBucket);
    sql.exec(
      "INSERT INTO load_times VALUES (?,?,?,?,?) ON CONFLICT(day,country,metric,bucket) DO UPDATE SET count=count+excluded.count",
      count(row.day),
      row.country,
      row.metric,
      bucket,
      count(row.count),
    );
  }
}
