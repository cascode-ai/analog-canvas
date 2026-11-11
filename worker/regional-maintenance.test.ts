import { afterEach, expect, it, vi } from "vitest";
import { pair } from "./regional-resource-actions.test-support";
import {
  adminOf,
  ownerAccountOf,
  ORIGIN,
  testbenchProjectText,
} from "./gallery.test-support";

afterEach(() => vi.unstubAllGlobals());

it("recycles a foreign duplicate group atomically and reconciles a lost reply after restart", async () => {
  const t = await pair();
  const keep = await t.publish(t.overseas),
    remove = await t.publish(t.overseas);
  const cookie = await t.auth.connect(await adminOf(t.auth.source));
  const ref = async (id: string) => ({
    id,
    previewRevision:
      (await (await t.cn.call(`/api/gallery/${id}`)).json()).entry
        .previewRevision || "legacy",
  });
  const body = { keep: await ref(keep), remove: [await ref(remove)] };
  const request = () =>
    t.cn.route(
      new Request(ORIGIN + "/api/gallery/duplicates/recycle", {
        method: "POST",
        headers: {
          origin: ORIGIN,
          cookie,
          "idempotency-key": "duplicates-once",
        },
        body: JSON.stringify(body),
      }),
    );
  t.loseNextReply();
  expect((await request()).status).toBe(503);
  t.overseas.restart();
  const result = await request();
  expect(result.status, await result.clone().text()).toBe(200);
  expect(await result.json()).toMatchObject({ kept: keep, recycled: [remove] });
  expect(
    (await t.cn.route(new Request(ORIGIN + `/api/gallery/${remove}`))).status,
  ).toBe(404);
  expect((await t.cn.call(`/api/gallery/${keep}`)).status).toBe(200);
});

it("reports every mixed-writer duplicate outcome and preserves atomicity within each writer", async () => {
  const t = await pair(),
    keep = await t.publish(t.cn),
    local = await t.publish(t.cn),
    first = await t.publish(t.overseas),
    last = await t.publish(t.overseas);
  const cookie = await adminOf(t.auth.source);
  const ref = async (id: string) => ({
    id,
    previewRevision:
      (await (await t.overseas.call(`/api/gallery/${id}`)).json()).entry
        .previewRevision || "legacy",
  });
  const body = {
    keep: await ref(keep),
    remove: [
      await ref(first),
      { ...(await ref(last)), previewRevision: "changed" },
      await ref(local),
    ],
  };
  const send = (cookie: string, key: string, input: unknown) =>
    t.overseas.route(
      new Request(ORIGIN + "/api/gallery/duplicates/recycle", {
        method: "POST",
        headers: { origin: ORIGIN, cookie, "idempotency-key": key },
        body: JSON.stringify(input),
      }),
    );
  expect((await send(t.cookie, "unauthorized", body)).status).toBe(403);
  const result = await send(cookie, "mixed-group", body);
  expect(result.status, await result.clone().text()).toBe(207);
  expect(await result.json()).toMatchObject({
    kept: keep,
    recycled: [local],
    results: [
      { id: first, ok: false, error: "duplicate-group-changed" },
      { id: last, ok: false, error: "duplicate-group-changed" },
      { id: local, ok: true },
    ],
  });
  expect(
    (await t.overseas.route(new Request(ORIGIN + `/api/gallery/${first}`)))
      .status,
  ).toBe(200);
  expect(
    (await t.overseas.route(new Request(ORIGIN + `/api/gallery/${local}`)))
      .status,
  ).toBe(404);
});

it("queues all writers once, keeps completed checks completed on retry, and totals progress without counting replicas twice", async () => {
  const t = await pair(),
    cnId = await t.publish(t.cn),
    sourceId = await t.publish(t.overseas);
  expect(
    (
      await t.cn.call(`/api/gallery/${cnId}`, "PUT", "bench-cn", {
        name: "CN testbench",
        description: "",
        tags: [],
        projectText: testbenchProjectText(),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await t.overseas.call(`/api/gallery/${sourceId}`, "PUT", "bench-source", {
        name: "Source testbench",
        description: "",
        tags: [],
        projectText: testbenchProjectText(),
      })
    ).status,
  ).toBe(200);
  const cookie = await t.auth.connect(await ownerAccountOf(t.auth.source));
  const request = () =>
    t.cn.route(
      new Request(ORIGIN + "/api/gallery/simulation-checks", {
        method: "POST",
        headers: { origin: ORIGIN, cookie, "idempotency-key": "queue-all" },
        body: JSON.stringify({ all: true }),
      }),
    );
  t.loseNextReply();
  const partial = await request();
  expect(partial.status).toBe(207);
  expect(await partial.json()).toMatchObject({
    queued: [cnId],
    failures: [{ region: "overseas", error: "action-unconfirmed" }],
  });
  const call = (site: typeof t.cn, operation: string, body: unknown = {}) =>
    site.store.fetch(
      new Request("https://gallery/" + operation, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  const running = await (await call(t.cn, "simulation-check-next")).json();
  expect(running.job.entryId).toBe(cnId);
  expect(
    await (
      await call(t.cn, "simulation-check-record", {
        ...running.job,
        digest: running.digest,
        verdict: {
          status: "pass",
          checkedAt: "2026-11-11T12:00:00.000Z",
          rule: 1,
          simulator: "isolated",
          folders: [],
        },
      })
    ).json(),
  ).toEqual({ recorded: true, done: true });
  const retry = await request();
  expect(retry.status, await retry.clone().text()).toBe(202);
  const retried = await retry.json();
  expect(retried.waiting).toBe(1);
  expect(retried.queued.sort()).toEqual([cnId, sourceId].sort());
  expect(
    (await (await call(t.cn, "simulation-check-next")).json()).job,
  ).toBeNull();
  const cursor = (
    await (
      await call(t.overseas, "resource-sync/status", { stream: "gallery" })
    ).json()
  ).received.sequence;
  const changes = await call(t.cn, "resource-sync/changes", {
    stream: "gallery",
    after: cursor,
  });
  expect(
    (
      await call(t.overseas, "resource-sync/receive", {
        stream: "gallery",
        envelope: await changes.json(),
      })
    ).status,
  ).toBe(200);
  const progress = await t.cn.route(
    new Request(ORIGIN + "/api/gallery/simulation-checks", {
      headers: { cookie },
    }),
  );
  expect(await progress.json()).toMatchObject({
    waiting: 1,
    counts: { pass: 1, fail: 0, error: 0, noTestbench: 0 },
  });
  // Legacy clients have no retry identity: a fresh request can still rerun checks.
  const legacy = () =>
    t.cn.route(
      new Request(ORIGIN + "/api/gallery/simulation-checks", {
        method: "POST",
        headers: { origin: ORIGIN, cookie },
        body: JSON.stringify({ ids: [cnId] }),
      }),
    );
  expect((await legacy()).status).toBe(202);
  const again = await (await call(t.cn, "simulation-check-next")).json();
  await call(t.cn, "simulation-check-record", {
    ...again.job,
    digest: again.digest,
    verdict: {
      status: "pass",
      checkedAt: "2026-11-11T12:01:00.000Z",
      rule: 1,
      simulator: "isolated",
      folders: [],
    },
  });
  expect((await legacy()).status).toBe(202);
  expect(
    (await (await call(t.cn, "simulation-check-next")).json()).job.entryId,
  ).toBe(cnId);
});

it("refuses forged maintenance actors, replication credentials and cross-site requests", async () => {
  const t = await pair(),
    id = await t.publish(t.overseas);
  const cookie = await t.auth.connect(await adminOf(t.auth.source));
  const request = (
    path: string,
    headers: Record<string, string>,
    body: unknown,
  ) =>
    t.cn.route(
      new Request(ORIGIN + path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
  expect(
    (
      await request(
        "/api/gallery/simulation-checks",
        { origin: ORIGIN, cookie },
        { ids: [id], actor: { isOwner: true } },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        "/api/gallery/duplicates/recycle",
        { origin: "https://stranger.test", cookie },
        { keep: { id, previewRevision: "legacy" }, remove: [] },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        "/api/resource-actions/maintenance",
        { authorization: "Bearer cn-sync" },
        {
          kind: "checks",
          target: "cn",
          commandId: "forged",
          body: { all: true },
          actor: { isOwner: true },
        },
      )
    ).status,
  ).toBe(401);
});

it("dispatches an Owner simulation check to its writer without treating a replica as missing", async () => {
  const t = await pair();
  const id = await t.publish(t.overseas);
  const cookie = await t.auth.connect(await ownerAccountOf(t.auth.source));
  const request = () =>
    t.cn.route(
      new Request(ORIGIN + "/api/gallery/simulation-checks", {
        method: "POST",
        headers: { origin: ORIGIN, cookie, "idempotency-key": "check-once" },
        body: JSON.stringify({ ids: [id] }),
      }),
    );
  t.loseNextReply();
  expect((await request()).status).toBe(503);
  const result = await request();
  expect(result.status, await result.clone().text()).toBe(202);
  expect(await result.json()).toMatchObject({ noTestbench: [id], missing: [] });
  expect((await (await t.cn.call(`/api/gallery/${id}`)).json()).entry.id).toBe(
    id,
  );
});
