// Helpers of the regional entry. workerd treats every named export of a
// main module as an entrypoint, so worker/regional-entry.ts exports only
// its handler and Durable Object classes.

/** The loopback timer's entrance to Production's scheduled work (wrangler.jsonc crons). */
export const REGIONAL_SCHEDULED_PATH = "/__regional/scheduled";

type Window = { start: number; count: number };
const windows = new Map<string, Map<string, Window>>();

/**
 * Production's simple rate limits for one process. Cloudflare's limiter is
 * per location and approximate; a fixed window per client address keeps the
 * same allowance. The trusted local proxy supplies the address.
 */
export function regionalRateLimiters(
  declaration: string | undefined,
  now: () => number = Date.now,
): Record<string, { limit(options: { key: string }): Promise<{ success: boolean }> }> {
  const limits = JSON.parse(declaration ?? "{}") as Record<
    string,
    { limit: number; period: number }
  >;
  return Object.fromEntries(
    Object.entries(limits).map(([name, { limit, period }]) => {
      const table = windows.get(name) ?? new Map<string, Window>();
      windows.set(name, table);
      return [
        name,
        {
          async limit({ key }: { key: string }) {
            const at = now(),
              span = period * 1000;
            let entry = table.get(key);
            if (!entry || at - entry.start >= span) {
              if (table.size > 10_000)
                for (const [k, w] of table)
                  if (at - w.start >= span) table.delete(k);
              entry = { start: at, count: 0 };
              table.set(key, entry);
            }
            entry.count++;
            return { success: entry.count <= limit };
          },
        },
      ];
    }),
  );
}
