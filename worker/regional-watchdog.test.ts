import { afterEach, expect, it, vi } from "vitest";
import { sqliteState } from "./gallery.test-support";
import { RegionalProjectDO } from "./regional-projects";
import { watchRegionalPulls } from "./regional-watchdog";

afterEach(() => vi.useRealTimers());
const MINUTE = 60_000;

it("alerts the Owner from the source when the private region stops pulling, then reports recovery", async () => {
  vi.useFakeTimers();
  const t0 = Date.UTC(2026, 10, 7, 12);
  vi.setSystemTime(t0);
  const source = new RegionalProjectDO(sqliteState(), {
    PROJECT_REGION: "overseas",
  });
  const region = new RegionalProjectDO(sqliteState(), { PROJECT_REGION: "cn" });
  const pull = async () =>
    source.handle("sync-pull", {
      status: await (await region.handle("sync-status", {})).json(),
    });
  const mails: { subject: string; to: string }[] = [];
  let mailUp = true;
  const resend = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (!mailUp) return new Response("down", { status: 503 });
    mails.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "sent" });
  }) as unknown as typeof fetch;
  const env = {
    PROJECT_REGION: "overseas",
    PROJECT_SYNC_TOKEN: "peer",
    RESEND_API_KEY: "key",
    AUTH_EMAIL_FROM: "alerts@example.test",
    ADMIN_EMAILS: "owner@example.test, second@example.test",
    GALLERY: {
      getByName: () => ({
        fetch: (url: string, init?: RequestInit) =>
          source.fetch(new Request(url, init)),
      }),
    },
  };
  const tick = (at: number) => watchRegionalPulls(env, at, resend);

  // A region that never pulled is not monitored.
  expect(await tick(t0 + 30 * MINUTE)).toBeNull();
  expect((await pull()).status).toBe(200);
  expect(await tick(t0 + 5 * MINUTE)).toBeNull();
  mailUp = false;
  expect(await tick(t0 + 11 * MINUTE)).toBeNull();
  mailUp = true;
  // The unsent alert is retried on the next tick, then repeats only hourly.
  expect(await tick(t0 + 16 * MINUTE)).toBe("alert");
  expect(await tick(t0 + 40 * MINUTE)).toBeNull();
  expect(await tick(t0 + 77 * MINUTE)).toBe("alert");
  vi.setSystemTime(t0 + 78 * MINUTE);
  expect((await pull()).status).toBe(200);
  expect(await tick(t0 + 79 * MINUTE)).toBe("recover");
  expect(await tick(t0 + 84 * MINUTE)).toBeNull();
  expect(mails.map((m) => m.subject)).toEqual([
    "Analog Canvas China region silent for 16 min",
    "Analog Canvas China region silent for 77 min",
    "Analog Canvas China region pulling again",
  ]);
  expect(new Set(mails.map((m) => m.to))).toEqual(
    new Set(["owner@example.test"]),
  );
});

it("watches nothing in the private region or without mail configuration", async () => {
  const resend = vi.fn() as unknown as typeof fetch;
  expect(
    await watchRegionalPulls({ PROJECT_REGION: "cn", PROJECT_SYNC_TOKEN: "x" }, 0, resend),
  ).toBeNull();
  expect(
    await watchRegionalPulls(
      { PROJECT_REGION: "overseas", PROJECT_SYNC_TOKEN: "x" },
      0,
      resend,
    ),
  ).toBeNull();
  expect(resend).not.toHaveBeenCalled();
});
