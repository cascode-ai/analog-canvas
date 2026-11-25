import { afterEach, expect, it, vi } from "vitest";
import { CURRENT_MODEL_SCHEMA_VERSION } from "@icm/model";
import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import { pair } from "./regional-resource-actions.test-support";
import { sha256Hex } from "@icm/derived";
import { digest } from "./regional-auth-contract";
import {
  recycleDuplicateGroup,
  DuplicateCleanupIncomplete,
} from "../apps/editor/src/gallery-duplicate-cleanup";
import type { GalleryFeedEntry } from "../apps/editor/src/gallery-client";
import {
  adminOf,
  ownerAccountOf,
  ORIGIN,
  testbenchProjectText,
} from "./gallery.test-support";

afterEach(() => vi.unstubAllGlobals());

it("reconciles each original duplicate intent after partial display removal and another uncertain group", async () => {
  const t = await pair();
  const keep = await t.publish(t.cn),
    local = await t.publish(t.cn),
    foreign = await t.publish(t.overseas),
    otherKeep = await t.publish(t.overseas),
    otherRemove = await t.publish(t.overseas);
  const cookie = await t.auth.connect(await adminOf(t.auth.source));
  const entry = async (id: string) =>
    (await (await t.cn.call(`/api/gallery/${id}`)).json())
      .entry as GalleryFeedEntry;
  const group = await Promise.all([keep, local, foreign].map(entry)),
    other = await Promise.all([otherKeep, otherRemove].map(entry));
  const delivered: { key: string | null; body: string }[] = [];
  const fetchLike = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("origin", ORIGIN);
    headers.set("cookie", cookie);
    delivered.push({
      key: headers.get("idempotency-key"),
      body: String(init?.body),
    });
    return t.cn.route(
      new Request(new URL(String(input), ORIGIN), { ...init, headers }),
    );
  }) as typeof fetch;
  t.loseNextReply();
  let incomplete: unknown;
  try {
    await recycleDuplicateGroup(group, keep, fetchLike);
  } catch (error) {
    incomplete = error;
  }
  expect(incomplete).toBeInstanceOf(DuplicateCleanupIncomplete);
  expect((incomplete as DuplicateCleanupIncomplete).recycled).toEqual([local]);
  t.loseNextReply();
  await expect(
    recycleDuplicateGroup(other, otherKeep, fetchLike),
  ).rejects.toThrow();
  t.overseas.restart();
  expect(
    await recycleDuplicateGroup(
      group.filter((e) => e.id !== local),
      keep,
      fetchLike,
    ),
  ).toEqual([foreign]);
  expect(await recycleDuplicateGroup(other, otherKeep, fetchLike)).toEqual([
    otherRemove,
  ]);
  expect(delivered[2]).toEqual(delivered[0]);
  expect(delivered[3]).toEqual(delivered[1]);
  expect(delivered[0]?.key).not.toBe(delivered[1]?.key);
});

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

type Site = Awaited<ReturnType<typeof pair>>["cn"];
const op = (site: Site, operation: string, body: unknown) =>
  site.store.fetch(
    new Request("https://gallery/" + operation, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
async function sync(from: Site, to: Site) {
  const after =
    (await (await op(to, "resource-sync/status", { stream: "gallery" })).json())
      .received?.sequence ?? 0;
  const envelope = await (
    await op(from, "resource-sync/changes", { stream: "gallery", after })
  ).json();
  expect(
    (await op(to, "resource-sync/receive", { stream: "gallery", envelope }))
      .status,
  ).toBe(200);
}
const sqlOf = (site: Site) => (site.store as any).sql;
const rowOf = (site: Site, table: string, id: string) =>
  sqlOf(site)
    .exec(`SELECT project_text, schema_version FROM ${table} WHERE id = ?`, id)
    .one() as { project_text: string; schema_version: number };
/** Store a row the way an older release wrote it; returns that text. */
function legacy(site: Site, table: string, id: string, indent?: number) {
  const text = JSON.stringify(
    parseProject(rowOf(site, table, id).project_text),
    null,
    indent,
  );
  sqlOf(site).exec(
    `UPDATE ${table} SET project_text = ?, schema_version = ? WHERE id = ?`,
    text,
    CURRENT_MODEL_SCHEMA_VERSION,
    id,
  );
  return text;
}
const formatRequest = (site: Site, cookie: string, body: unknown) =>
  site.route(
    new Request(ORIGIN + "/api/gallery/maintenance/project-format", {
      method: "POST",
      headers: { origin: ORIGIN, cookie },
      body: JSON.stringify(body),
    }),
  );
const formatBody = (
  table: string,
  id: string,
  originalProjectText: string,
) => ({
  table,
  id,
  originalProjectText,
  projectText: serializeProject(parseProject(originalProjectText)),
});

it("migrates every Gallery row at its writer region from one entrance, versions under their entry", async () => {
  const t = await pair(),
    local = await t.publish(t.cn),
    foreign = await t.publish(t.overseas);
  const update = await t.overseas.call(`/api/gallery/${foreign}`, "PUT", "v2", {
    name: "Second",
    description: "",
    tags: [],
    projectText: rowOf(t.overseas, "gallery_entries", foreign).project_text,
  });
  expect(update.status, await update.clone().text()).toBe(200);
  const version = sqlOf(t.overseas)
    .exec("SELECT id FROM gallery_entry_versions WHERE entry_id = ?", foreign)
    .one().id as string;
  const rows = [
    ["galleryEntries", "gallery_entries", local, t.cn],
    ["galleryEntries", "gallery_entries", foreign, t.overseas],
    ["galleryEntryVersions", "gallery_entry_versions", version, t.overseas],
  ] as const;
  const originals = rows.map(([, table, id, writer]) =>
    legacy(writer, table, id),
  );
  await sync(t.cn, t.overseas);
  await sync(t.overseas, t.cn);
  const cookie = await t.auth.connect(await adminOf(t.auth.source));
  for (const [index, [table, sqlTable, id, writer]] of rows.entries()) {
    const body = formatBody(table, id, originals[index]!);
    expect((await formatRequest(t.cn, t.cnCookie, body)).status).toBe(401);
    const result = await formatRequest(t.cn, cookie, body);
    expect(result.status, await result.clone().text()).toBe(200);
    expect(await result.json()).toEqual({
      id,
      changed: true,
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    });
    for (const site of new Set([t.cn, writer]))
      expect(rowOf(site, sqlTable, id)).toEqual({
        project_text: body.projectText,
        schema_version: CURRENT_PROJECT_FILE_VERSION,
      });
    expect(await (await formatRequest(t.cn, cookie, body)).json()).toEqual({
      id,
      changed: false,
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    });
  }
});

it("refuses a writer row changed since the entrance read it and reports a lost reply as unconfirmed", async () => {
  const t = await pair(),
    id = await t.publish(t.overseas);
  const seen = legacy(t.overseas, "gallery_entries", id);
  await sync(t.overseas, t.cn);
  // A concurrent edit at the writer that the entrance has not yet received.
  const current = legacy(t.overseas, "gallery_entries", id, 1);
  const cookie = await t.auth.connect(await adminOf(t.auth.source));
  const altered = await formatRequest(t.cn, cookie, {
    ...formatBody("galleryEntries", id, seen),
    projectText: seen,
  });
  expect(altered.status).toBe(422);
  const stale = await formatRequest(
    t.cn,
    cookie,
    formatBody("galleryEntries", id, seen),
  );
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: "concurrent-change" });
  expect(rowOf(t.overseas, "gallery_entries", id).project_text).toBe(current);
  expect(rowOf(t.cn, "gallery_entries", id).project_text).toBe(seen);
  await sync(t.overseas, t.cn);
  const body = formatBody("galleryEntries", id, current);
  t.loseNextReply();
  const lost = await formatRequest(t.cn, cookie, body);
  expect(lost.status).toBe(503);
  expect(await lost.json()).toEqual({
    error: "action-unconfirmed",
    region: "overseas",
  });
  const retried = await formatRequest(t.cn, cookie, body);
  expect(retried.status, await retried.clone().text()).toBe(200);
  expect(await retried.json()).toMatchObject({ changed: false });
  expect(rowOf(t.cn, "gallery_entries", id)).toEqual({
    project_text: body.projectText,
    schema_version: CURRENT_PROJECT_FILE_VERSION,
  });
});

it("migrates a cn row from the overseas entrance and reports a catch-up failure as pending", async () => {
  const t = await pair(),
    id = await t.publish(t.cn);
  const original = legacy(t.cn, "gallery_entries", id);
  await sync(t.cn, t.overseas);
  const cookie = await adminOf(t.auth.source);
  const body = formatBody("galleryEntries", id, original);
  t.loseNextCatchup();
  const pending = await formatRequest(t.overseas, cookie, body);
  expect(pending.status).toBe(503);
  expect(await pending.json()).toEqual({
    error: "action-propagation-pending",
  });
  expect(rowOf(t.cn, "gallery_entries", id).project_text).toBe(
    body.projectText,
  );
  const retried = await formatRequest(t.overseas, cookie, body);
  expect(retried.status, await retried.clone().text()).toBe(200);
  expect(await retried.json()).toMatchObject({ changed: false });
  expect(rowOf(t.overseas, "gallery_entries", id)).toEqual({
    project_text: body.projectText,
    schema_version: CURRENT_PROJECT_FILE_VERSION,
  });
});

it("refuses format commands at the writer without an admin, for another writer or with a changed body", async () => {
  const t = await pair(),
    foreign = await t.publish(t.overseas),
    local = await t.publish(t.cn);
  const original = legacy(t.overseas, "gallery_entries", foreign);
  const admin = await t.auth.connect(await adminOf(t.auth.source));
  const command = (id: string, text: string) => ({
    kind: "format",
    target: "overseas",
    commandId: "format-" + id,
    body: {
      table: "galleryEntries",
      id,
      originalSha256: sha256Hex(text),
      projectSha256: sha256Hex(serializeProject(parseProject(text))),
    },
  });
  const capability = async (cookie: string, value: unknown) =>
    (
      await (
        await t.cn.env
          .AUTH!.getByName("auth")
          .fetch("https://auth/internal/resource-action-authorize", {
            method: "POST",
            headers: { cookie },
            body: JSON.stringify({
              binding: await digest(JSON.stringify(value)),
            }),
          })
      ).json()
    ).token as string;
  const deliver = (token: string, value: unknown) =>
    t.overseas.route(
      new Request(ORIGIN + "/api/resource-actions/maintenance", {
        method: "POST",
        headers: { authorization: "Bearer " + token },
        body: JSON.stringify(value),
      }),
    );
  const migrate = command(foreign, original);
  const maker = await deliver(await capability(t.cnCookie, migrate), migrate);
  expect(maker.status).toBe(403);
  const tampered = {
    ...migrate,
    body: { ...migrate.body, projectSha256: migrate.body.originalSha256 },
  };
  expect(
    (await deliver(await capability(admin, migrate), tampered)).status,
  ).toBe(401);
  const elsewhere = command(local, original);
  const wrong = await deliver(await capability(admin, elsewhere), elsewhere);
  expect(wrong.status).toBe(409);
  expect(await wrong.json()).toEqual({ error: "wrong-writer" });
  const misrouted = { ...migrate, target: "cn" };
  expect(
    (await deliver(await capability(admin, misrouted), misrouted)).status,
  ).toBe(400);
  expect(rowOf(t.overseas, "gallery_entries", foreign).project_text).toBe(
    original,
  );
});

it("lists, reads, and records local simulation checks across regions with an Owner token (#2610)", async () => {
  const t = await pair(),
    cnId = await t.publish(t.cn),
    overseasId = await t.publish(t.overseas);
  const benchText = testbenchProjectText();
  const folderName = JSON.parse(benchText).simulationFolders[0].name as string;
  expect(
    (
      await t.cn.call(`/api/gallery/${cnId}`, "PUT", "local-bench-cn", {
        name: "CN Bench",
        description: "",
        tags: [],
        projectText: benchText,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await t.overseas.call(
        `/api/gallery/${overseasId}`,
        "PUT",
        "local-bench-os",
        {
          name: "Overseas Bench",
          description: "",
          tags: [],
          projectText: benchText,
        },
      )
    ).status,
  ).toBe(200);
  await sync(t.cn, t.overseas);
  await sync(t.overseas, t.cn);

  const ownerCookie = await ownerAccountOf(t.auth.source);
  const minted = (await (
    await t.auth.source.authDurable.fetch(
      new Request(ORIGIN + "/api/auth/owner-tokens", {
        method: "POST",
        headers: { origin: ORIGIN, cookie: ownerCookie },
        body: JSON.stringify({ label: "Local sim verify" }),
      }),
    )
  ).json()) as { token: string };
  const authHeaders = {
    authorization: "Bearer " + minted.token,
    "content-type": "application/json",
  };

  // Unauthorized and non-Owner callers stay refused.
  expect(
    (
      await t.overseas.route(
        new Request(ORIGIN + "/api/gallery/simulation-checks/inputs"),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await t.overseas.route(
        new Request(ORIGIN + `/api/gallery/${cnId}/simulation-check/input`, {
          headers: { origin: ORIGIN, cookie: t.cookie },
        }),
      )
    ).status,
  ).toBe(403);

  // Inputs merges both overseas and CN public entries with testbenches.
  const inputsRes = await t.overseas.route(
    new Request(ORIGIN + "/api/gallery/simulation-checks/inputs", {
      headers: authHeaders,
    }),
  );
  expect(inputsRes.status, await inputsRes.clone().text()).toBe(200);
  const listed = (await inputsRes.json()) as {
    entries: { id: string; name: string }[];
  };
  expect(listed.entries.map((entry) => entry.id)).toEqual(
    expect.arrayContaining([overseasId, cnId]),
  );

  // Reading a foreign-region (CN-owned) entry's input routes to its writer instead of 409 wrong-writer.
  const inputRes = await t.overseas.route(
    new Request(ORIGIN + `/api/gallery/${cnId}/simulation-check/input`, {
      headers: authHeaders,
    }),
  );
  expect(inputRes.status, await inputRes.clone().text()).toBe(200);
  const input = (await inputRes.json()) as {
    id: string;
    name: string;
    projectText: string;
    projectDigest: string;
    testbenchDigest: string;
  };
  expect(input).toMatchObject({
    id: cnId,
    name: "CN Bench",
    projectDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    testbenchDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
  });

  // Stale digest is refused with 409 stale-content from the writer.
  const staleRes = await t.overseas.route(
    new Request(ORIGIN + `/api/gallery/${cnId}/simulation-check`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        projectDigest: "0".repeat(64),
        testbenchDigest: input.testbenchDigest,
        status: "pass",
        checkedAt: new Date().toISOString(),
        folders: [
          {
            name: folderName,
            status: "pass",
            simulator: "ngspice ngspice-46",
            profileId: "hosted-sky130-ngspice-v1",
            specs: [
              {
                name: "vmid",
                expected: "[0.45, 0.55]",
                value: 0.5,
                unit: "V",
                judgment: "pass",
              },
            ],
          },
        ],
      }),
    }),
  );
  expect(staleRes.status).toBe(409);
  expect(await staleRes.json()).toEqual({ error: "stale-content" });

  // Recording a valid local verdict routes to CN, commits, and catches up overseas immediately.
  const checkedAt = new Date().toISOString();
  const recordRes = await t.overseas.route(
    new Request(ORIGIN + `/api/gallery/${cnId}/simulation-check`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        projectDigest: input.projectDigest,
        testbenchDigest: input.testbenchDigest,
        status: "pass",
        checkedAt,
        folders: [
          {
            name: folderName,
            status: "pass",
            simulator: "ngspice ngspice-46",
            profileId: "hosted-sky130-ngspice-v1",
            specs: [
              {
                name: "vmid",
                expected: "[0.45, 0.55]",
                value: 0.5,
                unit: "V",
                judgment: "pass",
              },
            ],
          },
        ],
      }),
    }),
  );
  expect(recordRes.status, await recordRes.clone().text()).toBe(200);
  expect(await recordRes.json()).toMatchObject({
    recorded: true,
    check: { status: "pass", origin: "local" },
  });

  // Overseas immediately sees the recorded verdict without needing a manual sync.
  const readCheck = await t.overseas.route(
    new Request(ORIGIN + `/api/gallery/${cnId}/simulation-check`, {
      headers: { cookie: ownerCookie },
    }),
  );
  expect(readCheck.status).toBe(200);
  expect(await readCheck.json()).toMatchObject({
    check: { status: "pass", origin: "local" },
  });
});
