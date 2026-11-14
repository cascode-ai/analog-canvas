import { afterEach, expect, it, vi } from "vitest";
import { pair } from "./regional-resource-actions.test-support";
import { routeGalleryRequest } from "./gallery";
import {
  ORIGIN,
  signIn,
  ownerAccountOf,
  wiredProjectText,
  saveRequest,
} from "./gallery.test-support";

afterEach(() => vi.unstubAllGlobals());

it("uses a commit endpoint that an older Gallery router refuses before mutation", async () => {
  const { cn, cnCookie } = await pair();
  const prepared = await cn.call("/api/gallery/submissions/intent", "POST");
  const { key } = await prepared.json();
  const body = {
    name: "Rolling release",
    description: "Synthetic",
    projectText: wiredProjectText(),
  };
  const request = () =>
    new Request(ORIGIN + "/api/gallery/submissions/commit", {
      method: "POST",
      headers: { cookie: cnCookie, origin: ORIGIN, "idempotency-key": key },
      body: JSON.stringify(body),
    });
  // The unchanged legacy Gallery router has no commit operation. A new
  // browser may reach an old entry during the regional release interval.
  expect((await routeGalleryRequest(request(), cn.env))?.status).toBe(404);
  const committed = await cn.route(request());
  expect(committed.status, await committed.clone().text()).toBe(201);
  const retried = await cn.route(request());
  expect(await retried.json()).toEqual(await committed.json());
});

it("keeps commit retries idempotent on a standalone deployment and refuses a missing key", async () => {
  const { cn } = await pair();
  Object.assign(cn.env, {
    RESOURCE_ACTION_PEER: undefined,
    RESOURCE_REGION: undefined,
  });
  const body = {
    name: "Standalone",
    description: "Synthetic",
    projectText: wiredProjectText(),
  };
  const path = "/api/gallery/submissions/commit";
  expect((await cn.call(path, "POST", undefined, body)).status).toBe(400);
  const { key } = await (
    await cn.call("/api/gallery/submissions/intent", "POST")
  ).json();
  const first = await cn.call(path, "POST", key, body);
  expect(first.status, await first.clone().text()).toBe(201);
  const retry = await cn.call(path, "POST", key, body);
  expect(await retry.json()).toEqual(await first.json());
});

it("refuses a regional commit when routing is incomplete or the deployment is standalone", async () => {
  const { cn } = await pair();
  const body = {
    name: "Keep fixed writer",
    description: "Synthetic",
    projectText: wiredProjectText(),
  };
  const path = "/api/gallery/submissions/commit";
  const key = "overseas_77777777-7777-4777-8777-777777777777";
  const peer = cn.env.RESOURCE_ACTION_PEER;
  Object.assign(cn.env, { RESOURCE_ACTION_PEER: undefined });
  expect((await cn.call(path, "POST", key, body)).status).toBe(503);
  Object.assign(cn.env, {
    RESOURCE_ACTION_PEER: peer,
    RESOURCE_REGION: undefined,
  });
  expect((await cn.call(path, "POST", key, body)).status).toBe(503);
  Object.assign(cn.env, { RESOURCE_ACTION_PEER: undefined });
  expect((await cn.call(path, "POST", key, body)).status).toBe(503);
  expect((await (await cn.call("/api/gallery")).json()).entries).toHaveLength(
    0,
  );
});

it("resolves an unsynchronized review at its writer without relaxing Owner permission", async () => {
  const { cn, overseas, publish, auth } = await pair();
  const id = await publish(cn);
  const revision = (await (await cn.call(`/api/gallery/${id}`)).json()).entry
    .previewRevision;
  const reviewer = await signIn(
    auth.source.authDurable,
    "reviewer@example.test",
  );
  const response = await cn.route(
    new Request(ORIGIN + `/api/gallery/${id}/reviews`, {
      method: "POST",
      headers: { cookie: await auth.connect(reviewer), origin: ORIGIN },
      body: JSON.stringify({
        revision,
        verdict: "issue",
        flags: ["wiring"],
        note: "Synthetic review",
        marks: [],
      }),
    }),
  );
  expect(response.status).toBe(200);
  const reviewId = (await response.json()).review.id;
  expect(
    (await (await overseas.call(`/api/gallery/${id}/reviews`)).json()).history,
  ).toHaveLength(0);
  const resolve = (cookie: string) =>
    overseas.route(
      new Request(ORIGIN + `/api/gallery/${id}/reviews/${reviewId}`, {
        method: "PATCH",
        headers: { cookie, origin: ORIGIN },
        body: JSON.stringify({ resolved: true }),
      }),
    );
  expect((await resolve(reviewer)).status).toBe(403);
  const resolved = await resolve(await ownerAccountOf(auth.source));
  expect(resolved.status, await resolved.clone().text()).toBe(200);
  expect(
    (await (await overseas.call(`/api/gallery/${id}/reviews`)).json()).history,
  ).toMatchObject([{ id: reviewId, resolved: true }]);
});

it("reconciles a first publication from the opposite entrance after a lost reply", async () => {
  const { cn, overseas, cnCookie, loseNextReply } = await pair({
    projects: true,
  });
  const saved = await cn.route(
    saveRequest(cnCookie, "Unpublished private draft"),
  );
  expect(saved.status).toBe(201);
  const draft = (await saved.json()).project;
  const body = {
    name: "Retry publication",
    description: "Synthetic",
    projectText: wiredProjectText(),
    cloudProjectId: draft.id,
    expectedGalleryEntryId: null,
  };
  const key = "cn_11111111-1111-4111-8111-111111111111";
  loseNextReply();
  expect(
    (await overseas.call("/api/gallery/submissions", "POST", key, body)).status,
  ).toBe(503);
  cn.restart();
  const retry = await cn.call("/api/gallery/submissions", "POST", key, body);
  expect(retry.status, await retry.clone().text()).toBe(201);
  const result = await retry.json();
  // A restarted Project journal waits for the normal authenticated peer
  // reconciliation before it participates in foreign publication catch-up.
  Object.assign(cn.env, { PROJECT_SYNC_ADMIN_TOKEN: "synthetic-sync-admin" });
  const sync = await cn.route(
    new Request(ORIGIN + "/api/project-sync/run", {
      method: "POST",
      headers: { authorization: "Bearer synthetic-sync-admin" },
    }),
  );
  expect(await sync.json()).toMatchObject({ status: "sent" });
  const across = await overseas.call(
    "/api/gallery/submissions",
    "POST",
    key,
    body,
  );
  expect(across.status, await across.clone().text()).toBe(201);
  expect(await across.json()).toEqual(result);
  expect(
    (await (await overseas.call(`/api/projects/${draft.id}`)).json()).project
      .galleryEntryId,
  ).toBe(result.id);
  expect(
    (
      await cn.call("/api/gallery/submissions", "POST", key, {
        ...body,
        name: "Changed",
      })
    ).status,
  ).toBe(409);
  const next = await cn.call(
    "/api/gallery/submissions",
    "POST",
    "cn_22222222-2222-4222-8222-222222222222",
    { ...body, expectedGalleryEntryId: result.id },
  );
  expect(next.status).toBe(201);
  expect((await next.json()).id).not.toBe(result.id);
});

it("records one review for a retry across entrances and a new history item for a new judgment", async () => {
  const { cn, overseas, publish, auth, loseNextReply } = await pair();
  const id = await publish(cn);
  const revision = (await (await cn.call(`/api/gallery/${id}`)).json()).entry
    .previewRevision;
  const cookie = await signIn(
    auth.source.authDurable,
    "review-retry@example.test",
  );
  const cnCookie = await auth.connect(cookie);
  const body = {
    revision,
    verdict: "issue",
    flags: ["wiring"],
    note: "One judgment",
    marks: [],
  };
  const key = "overseas_33333333-3333-4333-8333-333333333333";
  const post = (site: typeof cn, intent: string, input = body) =>
    site.route(
      new Request(ORIGIN + `/api/gallery/${id}/reviews`, {
        method: "POST",
        headers: {
          cookie: site === cn ? cnCookie : cookie,
          origin: ORIGIN,
          "idempotency-key": intent,
        },
        body: JSON.stringify(input),
      }),
    );
  loseNextReply();
  expect((await post(cn, key)).status).toBe(503);
  overseas.restart();
  const retry = await post(overseas, key);
  expect(retry.status, await retry.clone().text()).toBe(200);
  const result = await retry.json();
  const across = await post(cn, key);
  expect(across.status, await across.clone().text()).toBe(200);
  expect(await across.json()).toEqual(result);
  expect((await post(cn, key, { ...body, note: "Changed input" })).status).toBe(
    409,
  );
  expect(
    (await (await cn.call(`/api/gallery/${id}/reviews`)).json()).history,
  ).toHaveLength(1);
  expect(
    (await post(overseas, "overseas_44444444-4444-4444-8444-444444444444"))
      .status,
  ).toBe(200);
  expect(
    (await (await overseas.call(`/api/gallery/${id}/reviews`)).json()).history,
  ).toHaveLength(2);
});

it("keeps a bare retry key on one writer and refuses an unsigned peer submission", async () => {
  const { cn, overseas } = await pair();
  const body = {
    name: "Legacy key",
    description: "Synthetic",
    projectText: wiredProjectText(),
  };
  const first = await cn.call(
    "/api/gallery/submissions",
    "POST",
    "old-client-key",
    body,
  );
  expect(first.status, await first.clone().text()).toBe(201);
  const second = await overseas.call(
    "/api/gallery/submissions",
    "POST",
    "old-client-key",
    body,
  );
  expect(second.status, await second.clone().text()).toBe(201);
  expect(await second.json()).toEqual(await first.json());
  const forged = await cn.route(
    new Request(ORIGIN + "/api/resource-actions/submission", {
      method: "POST",
      headers: { "x-arena-account": "owner", authorization: "Bearer cn-sync" },
      body: JSON.stringify({
        path: "/api/gallery/submissions",
        body,
        commandId: "cn_66666666-6666-4666-8666-666666666666",
        target: "cn",
        user: { id: "owner", isOwner: true },
      }),
    }),
  );
  expect(forged.status).toBe(401);
});
