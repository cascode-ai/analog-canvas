import { DatabaseSync } from "node:sqlite";

import type { AnalyticsRouteEnv } from "./routes";
import { AnalyticsDO } from "./worker";

/** Durable Object storage on in-memory SQLite, as the analytics object uses it. */
export function sqliteState(db = new DatabaseSync(":memory:")) {
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
        return callback();
      },
    },
  };
}

/**
 * The analytics routes in front of the real analytics object, as the Worker
 * binds them, on in-memory SQLite.
 */
export function liveAnalyticsEnv(
  db = new DatabaseSync(":memory:"),
): AnalyticsRouteEnv {
  const analytics = new AnalyticsDO(sqliteState(db));
  return {
    ANALYTICS_KEY: undefined,
    ANALYTICS: {
      getByName: () => ({
        fetch: (input, init) => analytics.fetch(new Request(input, init)),
      }),
    },
  };
}
