// Seam 2: Arena and Analog Canvas in the visitor statistics, through the
// analytics routes in front of the real analytics object (#1568).

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routeAnalyticsRequest, type AnalyticsRouteEnv } from "./routes";
import { liveAnalyticsEnv } from "./store.test-support";
import type { AnalyticsSummary } from "./worker";

const SITE = "https://analog-canvas.tokenzhang.com";
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_ONE = Date.UTC(2026, 9, 12, 9);

/** One page view's beacon, as a browser on the site sends it. */
async function view(
  env: AnalyticsRouteEnv,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const response = await routeAnalyticsRequest(
    new Request(`${SITE}/api/track`, {
      method: "POST",
      headers: {
        origin: SITE,
        "user-agent": "Mozilla/5.0 Firefox/150.0",
        ...headers,
      },
      body: JSON.stringify({ p: path, r: "", s: "" }),
    }),
    env,
  );
  return response!;
}

/** The visitor cookie a first view set, to send with the browser's next. */
function visitorCookie(response: Response): string {
  return response.headers.getSetCookie()[0]!.split(";")[0]!;
}

async function summary(env: AnalyticsRouteEnv): Promise<AnalyticsSummary> {
  const response = await routeAnalyticsRequest(
    new Request(`${SITE}/api/analytics`),
    env,
  );
  return (await response!.json()) as AnalyticsSummary;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the product split", () => {
  it("counts one browser on both products once in the day, once in each product and once in both", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const env = liveAnalyticsEnv();
    const browser = visitorCookie(await view(env, "/editor"));
    await view(env, "/arena", { cookie: browser });
    await view(env, "/arena", { cookie: browser });

    expect((await summary(env)).today).toEqual({
      date: "2026-10-12",
      pv: 3,
      uv: 1,
      products: {
        canvas: { pv: 1, uv: 1 },
        arena: { pv: 2, uv: 1 },
        both: 1,
      },
    });
  });

  it("counts /arena and the paths under /arena/ as Arena, and every other page as Analog Canvas", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const env = liveAnalyticsEnv();
    for (const path of ["/arena", "/arena/", "/arena/x", "/arena?season=1"])
      await view(env, path);
    for (const path of ["/arenafoo", "/", "/editor", "/g/abc"])
      await view(env, path);
    // Arena's API is not a page, as no API path is.
    const api = await view(env, "/api/arena/x");
    expect(api.status).toBe(204);

    // Each of these browsers used one product only, so none is in both.
    expect((await summary(env)).today).toMatchObject({
      pv: 8,
      uv: 8,
      products: {
        arena: { pv: 4, uv: 4 },
        canvas: { pv: 4, uv: 4 },
        both: 0,
      },
    });
  });
});

describe("a browser that asks not to be counted", () => {
  it("is counted in no product, and gets no visitor cookie", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const env = liveAnalyticsEnv();
    for (const headers of [
      { DNT: "1" },
      { "Sec-GPC": "1" },
      { cookie: "canvas_optout=1" },
    ]) {
      for (const path of ["/arena", "/editor"]) {
        const response = await view(env, path, headers);
        expect(response.status).toBe(204);
        expect(response.headers.getSetCookie()).toEqual([]);
      }
    }

    expect((await summary(env)).today).toMatchObject({
      pv: 0,
      uv: 0,
      products: {
        canvas: { pv: 0, uv: 0 },
        arena: { pv: 0, uv: 0 },
      },
    });
  });
});

describe("history from before the product split", () => {
  it("keeps its counts with no split, and says when the split began", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const day = Math.floor(DAY_ONE / DAY_MS);
    const db = new DatabaseSync(":memory:");
    // A deployment from before the split: a finished day, and one view today.
    db.exec(`
      CREATE TABLE daily_views (day INTEGER PRIMARY KEY, views INTEGER NOT NULL);
      CREATE TABLE daily_visitor_counts (
        day INTEGER PRIMARY KEY,
        visitors INTEGER NOT NULL
      );
      CREATE TABLE daily_visitors (
        day INTEGER NOT NULL,
        visitor_hash TEXT NOT NULL,
        source TEXT,
        PRIMARY KEY (day, visitor_hash)
      ) WITHOUT ROWID;
      INSERT INTO daily_views VALUES (${day - 1}, 5), (${day}, 1);
      INSERT INTO daily_visitor_counts VALUES (${day - 1}, 3);
      INSERT INTO daily_visitors VALUES (${day}, '${"c".repeat(64)}', NULL);
    `);
    const env = liveAnalyticsEnv(db);
    await view(env, "/arena");

    const report = await summary(env);
    expect(report.productsStartedAt).toBe("2026-10-12T09:00:00.000Z");
    expect(report.days.slice(-2)).toEqual([
      { date: "2026-10-11", pv: 5, uv: 3, products: null },
      {
        date: "2026-10-12",
        pv: 2,
        uv: 2,
        products: {
          canvas: { pv: 0, uv: 0 },
          arena: { pv: 1, uv: 1 },
          both: 0,
        },
      },
    ]);
  });
});

describe("product retention", () => {
  it("turns a finished day's visitors into counts per product and in both, keeping only today's hashes", async () => {
    vi.useFakeTimers({ now: DAY_ONE });
    const db = new DatabaseSync(":memory:");
    const env = liveAnalyticsEnv(db);
    const ada = visitorCookie(await view(env, "/arena"));
    await view(env, "/editor", { cookie: ada });
    await view(env, "/editor");
    vi.setSystemTime(DAY_ONE + DAY_MS);
    await view(env, "/arena", { cookie: ada });

    const [yesterday, today] = (await summary(env)).days.slice(-2);
    expect(yesterday).toEqual({
      date: "2026-10-12",
      pv: 3,
      uv: 2,
      products: {
        canvas: { pv: 2, uv: 2 },
        arena: { pv: 1, uv: 1 },
        both: 1,
      },
    });
    expect(today).toEqual({
      date: "2026-10-13",
      pv: 1,
      uv: 1,
      products: {
        canvas: { pv: 0, uv: 0 },
        arena: { pv: 1, uv: 1 },
        both: 0,
      },
    });
    // As for the day's total, a product keeps visitor hashes only for today.
    const day = Math.floor((DAY_ONE + DAY_MS) / DAY_MS);
    expect(
      db.prepare("SELECT DISTINCT day FROM daily_product_visitors").all(),
    ).toEqual([{ day }]);
  });
});
