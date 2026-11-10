import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyticsDO, type AnalyticsSummary } from "./worker";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_ONE = Date.UTC(2026, 9, 1, 12);
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function sqliteState(db = new DatabaseSync(":memory:")) {
  let transaction = 0;
  return {
    storage: {
      sql: {
        exec<T>(query: string, ...bindings: unknown[]) {
          const statement = db.prepare(query);
          if (/^\s*(select|with|pragma)/iu.test(query)) {
            const rows = statement.all(
              ...(bindings as (string | number | null)[]),
            ) as T[];
            return {
              toArray: () => rows,
              one: () => {
                if (rows.length !== 1) throw new Error("expected one row");
                return rows[0]!;
              },
            };
          }
          statement.run(...(bindings as (string | number | null)[]));
          return {
            toArray: () => [] as T[],
            one: () => {
              throw new Error("no rows");
            },
          };
        },
      },
      transactionSync<T>(callback: () => T): T {
        const name = `analytics_test_${++transaction}`;
        db.exec(`SAVEPOINT ${name}`);
        try {
          const result = callback();
          db.exec(`RELEASE ${name}`);
          return result;
        } catch (error) {
          db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
          throw error;
        }
      },
    },
  };
}

async function hit(
  analytics: AnalyticsDO,
  visitorHash: string,
  extra: { path?: string; source?: string } = {},
) {
  const response = await analytics.fetch(
    new Request("https://analytics.internal/hit", {
      method: "POST",
      body: JSON.stringify({
        visitorHash,
        path: extra.path ?? "/",
        country: "CH",
        lat: 47.4,
        lng: 8.5,
        source: extra.source ?? "direct-or-unknown",
      }),
    }),
  );
  return (await response.json()) as { pv: number; uv: number };
}

async function summary(analytics: AnalyticsDO): Promise<AnalyticsSummary> {
  return (await analytics
    .fetch(new Request("https://analytics.internal/analytics"))
    .then((response) => response.json())) as AnalyticsSummary;
}

function rows(db: DatabaseSync, query: string) {
  return db.prepare(query).all();
}

afterEach(() => {
  vi.useRealTimers();
});

async function sync(analytics: AnalyticsDO, operation: string, body?: unknown) {
  return analytics.fetch(
    new Request(`https://analytics.internal/sync/${operation}`, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

describe("regional analytics", () => {
  it("deduplicates a still-valid cookie collected before expiry but delivered after ordinary hash retirement", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const source = new AnalyticsDO(sqliteState()),
      collector = new AnalyticsDO(sqliteState());
    await sync(source, "prepare", {});
    await hit(source, HASH_A);
    await sync(collector, "activate", { summary: await summary(source) });
    await sync(
      source,
      "seed",
      await (await sync(collector, "baseline")).json(),
    );
    vi.setSystemTime(DAY_ONE + 364 * DAY_MS);
    await hit(collector, HASH_A);
    const batch = await (await sync(collector, "batch")).json();
    vi.setSystemTime(DAY_ONE + 370 * DAY_MS);
    const receipt = await (await sync(source, "receive", batch)).json();
    expect(receipt.summary.totals).toEqual({ pv: 2, uv: 1 });
  });

  it("retires identities on authority sync traffic while preserving historic counts", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const source = new AnalyticsDO(sqliteState());
    await sync(source, "prepare", {});
    await hit(source, HASH_A);
    vi.setSystemTime(DAY_ONE + 7 * DAY_MS);
    expect((await (await sync(source, "summary")).json()).totals).toEqual({
      pv: 1,
      uv: 1,
    });
    const snapshot = await (
      await source.fetch(new Request("https://analytics.internal/backup"))
    ).json();
    expect(snapshot.tables.daily_visitors).toEqual([]);
    expect(snapshot.tables.daily_visitor_counts).toEqual([
      { day: Math.floor(DAY_ONE / DAY_MS), visitors: 1 },
    ]);
    vi.setSystemTime(DAY_ONE + 374 * DAY_MS);
    expect((await (await sync(source, "summary")).json()).totals).toEqual({
      pv: 1,
      uv: 1,
    });
    const retired = await (
      await source.fetch(new Request("https://analytics.internal/backup"))
    ).json();
    expect(retired.tables.visitors).toEqual([]);
  });

  it("retains an over-age batch for reconciliation instead of inventing historical visitor counts", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const source = new AnalyticsDO(sqliteState()),
      collector = new AnalyticsDO(sqliteState());
    await sync(source, "prepare", {});
    await sync(collector, "activate", { summary: await summary(source) });
    await sync(
      source,
      "seed",
      await (await sync(collector, "baseline")).json(),
    );
    await hit(collector, HASH_A);
    const batch = await (await sync(collector, "batch")).json();
    vi.setSystemTime(DAY_ONE + 8 * DAY_MS);
    expect((await sync(source, "receive", batch)).status).toBe(409);
    expect((await summary(source)).totals).toEqual({ pv: 0, uv: 0 });
    expect(await (await sync(collector, "status")).json()).toMatchObject({
      pending: 1,
      acknowledged: 0,
    });
  });

  it("deduplicates a legacy visitor already present overseas and refuses a baseline from before the shared daily window", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const source = new AnalyticsDO(sqliteState()),
      collector = new AnalyticsDO(sqliteState());
    await hit(source, HASH_A, { source: "social:github" });
    await hit(collector, HASH_A, { source: "direct-or-unknown" });
    await sync(source, "prepare", {});
    await sync(collector, "activate", { summary: await summary(source) });
    const baseline = await (await sync(collector, "baseline")).json();
    const old = structuredClone(baseline);
    old.snapshot.tables.daily_views[0].day -= 1;
    old.snapshot.tables.daily_visitors[0].day -= 1;
    old.snapshot.tables.visitors[0].last_seen_day -= 1;
    expect((await sync(source, "seed", old)).status).toBe(409);
    expect((await summary(source)).totals).toEqual({ pv: 1, uv: 1 });
    expect((await sync(source, "seed", baseline)).status).toBe(200);
    const report = await summary(source);
    expect(report.totals).toEqual({ pv: 2, uv: 1 });
    expect(report.today).toMatchObject({ pv: 2, uv: 1 });
    expect(report.sources).toEqual([{ source: "social:github", pv: 2, uv: 1 }]);
  });

  it("adds the frozen China baseline once without replacing overseas history", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const overseas = new AnalyticsDO(sqliteState());
    await hit(overseas, HASH_A);
    await sync(overseas, "prepare", {});
    const china = new AnalyticsDO(sqliteState());
    await hit(china, HASH_B);
    await hit(china, HASH_B, { path: "/editor" });
    await hit(china, HASH_B, { path: "/editor" });
    await sync(china, "activate", { summary: await summary(overseas) });
    const baseline = await (await sync(china, "baseline")).json();
    expect((await sync(overseas, "seed", baseline)).status).toBe(200);
    expect((await sync(overseas, "seed", baseline)).status).toBe(200);
    const result = await summary(overseas);
    expect(result.totals).toEqual({ pv: 4, uv: 2 });
    expect(result.today).toMatchObject({ pv: 4, uv: 2 });
    expect(result.paths).toContainEqual({ path: "/editor", pv: 2, uv: 0 });
  });

  it("counts a batch once after a lost acknowledgement and deduplicates returning browsers across regions", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const overseas = new AnalyticsDO(sqliteState());
    await hit(overseas, HASH_A);
    expect((await sync(overseas, "prepare", {})).status).toBe(200);
    const china = new AnalyticsDO(sqliteState());
    await sync(china, "activate", { summary: await summary(overseas) });
    const baseline = await (await sync(china, "baseline")).json();
    expect((await sync(overseas, "seed", baseline)).status).toBe(200);
    await hit(china, HASH_A);
    await hit(china, HASH_B);
    const batch = await (await sync(china, "batch")).json();
    const delivered = await sync(overseas, "receive", batch);
    expect(delivered.status).toBe(200);
    const receipt = await delivered.json();
    expect(receipt.summary.totals).toEqual({ pv: 3, uv: 2 });
    const repeated = await sync(overseas, "receive", batch);
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).summary.totals).toEqual({ pv: 3, uv: 2 });
    expect(
      (
        await Promise.all([
          sync(china, "ack", receipt),
          sync(china, "ack", receipt),
        ])
      ).map((response) => response.status),
    ).toEqual([200, 200]);
    expect((await sync(china, "ack", receipt)).status).toBe(200);
    expect((await summary(china)).totals).toEqual({ pv: 3, uv: 2 });
    expect(await (await sync(china, "status")).json()).toMatchObject({
      pending: 0,
      acknowledged: 2,
    });
    batch.events[0].payload.path = "/changed";
    expect((await sync(overseas, "receive", batch)).status).toBe(409);
    expect((await summary(overseas)).totals).toEqual({ pv: 3, uv: 2 });
  });

  it("keeps the collection date across a delayed delivery and rolls back an invalid batch in full", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const overseas = new AnalyticsDO(sqliteState());
    await hit(overseas, HASH_A);
    await sync(overseas, "prepare", {});
    const china = new AnalyticsDO(sqliteState());
    await sync(china, "activate", { summary: await summary(overseas) });
    await sync(overseas, "seed", await (await sync(china, "baseline")).json());
    await hit(china, HASH_A);
    await hit(china, HASH_B);
    const batch = await (await sync(china, "batch")).json();
    vi.setSystemTime(DAY_ONE + 2 * DAY_MS);
    await hit(overseas, HASH_A);
    const invalid = structuredClone(batch);
    invalid.events[1].payload.path = 42;
    expect((await sync(overseas, "receive", invalid)).status).toBe(400);
    expect((await summary(overseas)).totals).toEqual({ pv: 2, uv: 1 });
    expect((await sync(overseas, "receive", batch)).status).toBe(200);
    const report = await summary(overseas);
    expect(report.days.at(-3)).toMatchObject({ pv: 3, uv: 2 });
    expect(report.today).toMatchObject({ pv: 1, uv: 1 });
  });

  it("keeps collection durable and retries the same batch while serving the last global summary", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const overseas = new AnalyticsDO(sqliteState());
    await hit(overseas, HASH_A);
    const global = await summary(overseas);
    const state = sqliteState();
    const china = new AnalyticsDO(state);
    expect((await sync(china, "activate", { summary: global })).status).toBe(
      200,
    );
    await hit(china, HASH_A);
    const first = await (await sync(china, "batch")).json();
    expect(first.after).toBe(0);
    expect(first.events).toHaveLength(1);
    await hit(china, HASH_B);
    const restarted = new AnalyticsDO(state);
    expect(await (await sync(restarted, "batch")).json()).toEqual(first);
    expect((await summary(restarted)).totals).toEqual({ pv: 1, uv: 1 });
    expect(await (await sync(restarted, "status")).json()).toMatchObject({
      mode: "collector",
      pending: 2,
      acknowledged: 0,
    });
  });
});

describe("visitor counting", () => {
  it("refuses an oversized export before materializing rows and keeps counting available", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE visitors(visitor_hash TEXT PRIMARY KEY, last_seen_day INTEGER NOT NULL);
      WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<50001)
      INSERT INTO visitors SELECT printf('%064x',x), 1 FROM n;`);
    const analytics = new AnalyticsDO(sqliteState(db));
    const response = await analytics.fetch(
      new Request("https://analytics.internal/backup"),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "backup-too-large" });
    expect((await summary(analytics)).totals.uv).toBe(50001);
  });

  it("restores retired history and page-load buckets as well as current identities", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const original = new AnalyticsDO(sqliteState());
    await hit(original, HASH_A);
    vi.setSystemTime(DAY_ONE + 368 * DAY_MS);
    await hit(original, HASH_B);
    await original.fetch(
      new Request("https://analytics.internal/load", {
        method: "POST",
        body: JSON.stringify({ country: "CH", ttfb: 450, shown: 1200 }),
      }),
    );
    const backup = await (
      await original.fetch(new Request("https://analytics.internal/backup"))
    ).json();
    const db = new DatabaseSync(":memory:");
    for (const definition of backup.schema) db.exec(definition.sql);
    for (const [table, rows] of Object.entries(backup.tables)) {
      for (const row of rows as Record<string, string | number | null>[]) {
        const keys = Object.keys(row);
        db.prepare(
          `INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        ).run(...Object.values(row));
      }
    }
    const recovered = new AnalyticsDO(sqliteState(db));
    const report = await summary(recovered);
    expect(report.totals).toEqual({ pv: 2, uv: 2 });
    expect(report.days.at(-369)).toMatchObject({ pv: 1, uv: 1 });
    expect(report.loadTimes.all).toMatchObject({
      n: 1,
      ttfbP50: 500,
      shownP50: 1250,
    });
  });

  it("exports a complete restorable snapshot without retiring yesterday's identities", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const analytics = new AnalyticsDO(sqliteState());
    await hit(analytics, HASH_A);
    await hit(analytics, HASH_A, { path: "/editor" });
    vi.setSystemTime(DAY_ONE + DAY_MS);
    const response = await analytics.fetch(
      new Request("https://analytics.internal/backup"),
    );
    expect(response.status).toBe(200);
    const backup = await response.json();
    expect(backup.format).toBe("canvas-analytics-backup-v1");
    expect(backup.tables.daily_visitors).toEqual([
      {
        day: Math.floor(DAY_ONE / DAY_MS),
        visitor_hash: HASH_A,
        source: "direct-or-unknown",
      },
    ]);
    const restored = new DatabaseSync(":memory:");
    for (const definition of backup.schema) restored.exec(definition.sql);
    for (const [table, rows] of Object.entries(backup.tables)) {
      for (const row of rows as Record<string, string | number | null>[]) {
        const keys = Object.keys(row);
        restored
          .prepare(
            `INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
          )
          .run(...Object.values(row));
      }
    }
    const recovered = new AnalyticsDO(sqliteState(restored));
    expect((await summary(recovered)).totals).toEqual({ pv: 2, uv: 1 });
    expect(await hit(recovered, HASH_A)).toMatchObject({ pv: 3, uv: 1 });
    expect((await summary(recovered)).paths).toContainEqual({
      path: "/editor",
      pv: 1,
      uv: 0,
    });
  });

  it("counts a returning visitor once, whatever the day", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const analytics = new AnalyticsDO(sqliteState());
    await hit(analytics, HASH_A, { source: "social:github" });
    await hit(analytics, HASH_A, { path: "/editor" });
    vi.setSystemTime(DAY_ONE + 3 * DAY_MS);
    expect(await hit(analytics, HASH_A)).toEqual({
      pv: 3,
      uv: 1,
      scope: "all",
    });
    expect(await hit(analytics, HASH_B)).toMatchObject({ pv: 4, uv: 2 });
    const report = await summary(analytics);
    // Each day still counts who came that day.
    expect(report.days.at(-4)).toMatchObject({ pv: 2, uv: 1 });
    expect(report.days.at(-1)).toMatchObject({ pv: 2, uv: 2 });
    // The second view had no source of its own; it keeps GitHub's.
    expect(report.sources).toContainEqual({
      source: "social:github",
      pv: 2,
      uv: 1,
    });
  });

  it("keeps only today's hashes per day, and drops ids whose cookie expired", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const db = new DatabaseSync(":memory:");
    const analytics = new AnalyticsDO(sqliteState(db));
    await hit(analytics, HASH_A);
    vi.setSystemTime(DAY_ONE + DAY_MS);
    await hit(analytics, HASH_B);
    const day = Math.floor(DAY_ONE / DAY_MS);
    expect(rows(db, "SELECT day, visitors FROM daily_visitor_counts")).toEqual([
      { day, visitors: 1 },
    ]);
    expect(rows(db, "SELECT day FROM daily_visitors")).toEqual([
      { day: day + 1 },
    ]);

    // A year and a day later both cookies have expired: the ids go, and
    // the total keeps counting them.
    vi.setSystemTime(DAY_ONE + 368 * DAY_MS);
    const stats = await analytics
      .fetch(new Request("https://analytics.internal/stats"))
      .then((response) => response.json());
    expect(stats).toMatchObject({ uv: 2 });
    expect(rows(db, "SELECT visitor_hash FROM visitors")).toEqual([]);
  });

  it("starts the total from the visitors already counted, once", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const today = Math.floor(DAY_ONE / DAY_MS);
    const db = new DatabaseSync(":memory:");
    // A deployment from before the total became a counter.
    db.exec(`
      CREATE TABLE visitors (
        visitor_hash TEXT PRIMARY KEY,
        last_seen_day INTEGER NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE daily_views (day INTEGER PRIMARY KEY, views INTEGER NOT NULL);
      CREATE TABLE daily_visitors (
        day INTEGER NOT NULL,
        visitor_hash TEXT NOT NULL,
        PRIMARY KEY (day, visitor_hash)
      ) WITHOUT ROWID;
      INSERT INTO visitors VALUES ('${HASH_A}', ${today - 1}), ('x', ${today - 1}), ('y', ${today});
      INSERT INTO daily_views VALUES (${today - 1}, 5), (${today}, 2);
      INSERT INTO daily_visitors VALUES
        (${today - 1}, '${HASH_A}'), (${today - 1}, 'x'), (${today}, 'y');
    `);
    const analytics = new AnalyticsDO(sqliteState(db));
    const stats = await analytics
      .fetch(new Request("https://analytics.internal/stats"))
      .then((response) => response.json());
    expect(stats).toEqual({ pv: 7, uv: 3, scope: "all" });
    const days = (await summary(analytics)).days.slice(-2);
    expect(days.map((entry) => [entry.pv, entry.uv])).toEqual([
      [5, 2],
      [2, 1],
    ]);

    // A known visitor adds a view, not a visitor; a later start leaves the
    // total alone.
    const again = new AnalyticsDO(sqliteState(db));
    expect(await hit(again, HASH_A)).toMatchObject({ pv: 8, uv: 3 });
    expect(await hit(again, HASH_B)).toMatchObject({ pv: 9, uv: 4 });
  });
});

describe("page-load times (#1581)", () => {
  async function load(
    analytics: AnalyticsDO,
    country: string,
    ttfb: number,
    shown: number,
  ) {
    return analytics.fetch(
      new Request("https://analytics.internal/load", {
        method: "POST",
        body: JSON.stringify({ country, ttfb, shown }),
      }),
    );
  }

  it("keeps counts per country and summarizes medians and 75th percentiles", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const db = new DatabaseSync(":memory:");
    const analytics = new AnalyticsDO(sqliteState(db));
    for (const [ttfb, shown] of [
      [150, 1100],
      [180, 1200],
      [420, 2600],
    ])
      expect((await load(analytics, "CH", ttfb!, shown!)).status).toBe(204);
    await load(analytics, "CN", 900, 4200);
    // Nothing a visitor could be told apart by is accepted or kept.
    expect((await load(analytics, "cn", 900, 4200)).status).toBe(400);
    expect((await load(analytics, "CN", -1, 4200)).status).toBe(400);
    expect((await load(analytics, "CN", 900, 1.5)).status).toBe(400);
    expect(
      Object.keys(
        rows(db, "SELECT * FROM load_times LIMIT 1")[0] as object,
      ).sort(),
    ).toEqual(["bucket", "count", "country", "day", "metric"]);

    const { loadTimes } = await summary(analytics);
    expect(loadTimes.days).toBe(30);
    expect(loadTimes.all).toMatchObject({ code: "ALL", n: 4 });
    expect(loadTimes.countries).toEqual([
      {
        code: "CH",
        n: 3,
        ttfbP50: 200,
        ttfbP75: 500,
        shownP50: 1250,
        shownP75: 3000,
      },
      {
        code: "CN",
        n: 1,
        ttfbP50: 900,
        ttfbP75: 900,
        shownP50: 5000,
        shownP75: 5000,
      },
    ]);
  });

  it("summarizes only the last 30 days, and drops days past retention", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const db = new DatabaseSync(":memory:");
    const analytics = new AnalyticsDO(sqliteState(db));
    await load(analytics, "CH", 150, 1100);
    vi.setSystemTime(DAY_ONE + 30 * DAY_MS);
    expect((await summary(analytics)).loadTimes).toEqual({
      days: 30,
      all: null,
      countries: [],
    });
    vi.setSystemTime(DAY_ONE + 401 * DAY_MS);
    await summary(analytics);
    expect(rows(db, "SELECT day FROM load_times")).toEqual([]);
  });
});
