import { expect, it } from "vitest";
import { AuthDO, GalleryDO } from "./index";
import type { ReplicaConfig } from "./resource-replica";
import { ACCOUNT_DELETION_TICK } from "./account-deletions";
import {
  accounts,
  config,
  secret,
  transportOrigin,
} from "./regional-auth.test-support";
import { RegionalSessionDO } from "./regional-session";
import {
  makerOf,
  ORIGIN,
  route,
  sqliteState,
  submissionRequest,
  signIn,
  wiredProjectText,
} from "./gallery.test-support";

async function pair() {
  let loseNextBylineReply = false;
  let refuseSourceByline = false;
  const binding = (region: "cn" | "overseas") => {
    const state = sqliteState();
    const config: NonNullable<ConstructorParameters<typeof GalleryDO>[1]> &
      ReplicaConfig = {
      RESOURCE_REGION: region,
      RESOURCE_WRITES_ENABLED: "true",
    };
    let store = new GalleryDO(state, config);
    return {
      restart: () => {
        store = new GalleryDO(state, config);
      },
      getByName: () => ({
        fetch: async (input: string, init?: RequestInit) => {
          if (
            region === "overseas" &&
            input.endsWith("/rename-owner") &&
            refuseSourceByline
          )
            return Response.json({ error: "unavailable" }, { status: 503 });
          const response = await store.fetch(new Request(input, init));
          if (
            region === "cn" &&
            input.endsWith("/rename-owner") &&
            loseNextBylineReply
          ) {
            loseNextBylineReply = false;
            throw new Error("Lost Gallery reply after commit");
          }
          return response;
        },
      }),
    };
  };
  const overseas = binding("overseas"),
    cn = binding("cn");
  const h = accounts({ GALLERY: overseas }, { GALLERY: cn });
  const sourceCookie = await makerOf(h.source);
  const cnCookie = await h.connect(sourceCookie);
  const source = { ...h.source, GALLERY: overseas };
  const domestic = { ...h.resources, GALLERY: cn };
  const publish = async (region: "cn" | "overseas") => {
    const response = await route(
      region === "cn" ? domestic : source,
      submissionRequest(
        { name: "Byline fixture", projectText: wiredProjectText() },
        { cookie: region === "cn" ? cnCookie : sourceCookie },
      ),
    );
    expect(response.status).toBe(201);
    return (await response.json()).id as string;
  };
  const read = async (region: "cn" | "overseas", id: string, suffix = "") => {
    const response = await route(
      region === "cn" ? domestic : source,
      new Request(ORIGIN + `/api/gallery/${id}${suffix}`, {
        headers: { cookie: region === "cn" ? cnCookie : sourceCookie },
      }),
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  const tick = (region = h.region) =>
    region.fetch(
      new Request("https://auth" + ACCOUNT_DELETION_TICK, { method: "POST" }),
    );
  const rename = (displayName: string) =>
    h.source.authDurable.fetch(
      new Request(ORIGIN + "/api/auth/profile", {
        method: "POST",
        headers: { cookie: sourceCookie, origin: ORIGIN },
        body: JSON.stringify({ displayName }),
      }),
    );
  return {
    h,
    sourceCookie,
    cnCookie,
    source,
    domestic,
    publish,
    read,
    tick,
    rename,
    loseReply: () => {
      loseNextBylineReply = true;
    },
    refuseSource: (refuse: boolean) => {
      refuseSourceByline = refuse;
    },
    restart: () => {
      cn.restart();
      const regional = new RegionalSessionDO(h.state, {
        AUTH_REGIONAL_CLIENT: config,
        GALLERY: cn,
      });
      regional.fetchLike = h.region.fetchLike;
      return regional;
    },
  };
}

it("renames both publication writers and retained version bylines through a domestic profile change", async () => {
  const t = await pair();
  const cn = await t.publish("cn"),
    overseas = await t.publish("overseas");
  const edited = await route(
    t.domestic,
    new Request(ORIGIN + `/api/gallery/${cn}`, {
      method: "PATCH",
      headers: { cookie: t.cnCookie, origin: ORIGIN },
      body: JSON.stringify({
        name: "Renamed circuit",
        description: "History fixture",
      }),
    }),
  );
  expect(edited.status).toBe(200);
  const renamed = await t.h.call("/api/auth/profile", t.cnCookie, "POST", {
    displayName: "Unified author",
  });
  expect(renamed.status).toBe(200);
  expect((await t.read("cn", cn)).entry.author).toBe("Unified author");
  expect((await t.read("overseas", overseas)).entry.author).toBe(
    "Unified author",
  );
  const versions = await t.read("cn", cn, "/versions");
  expect(versions.versions[0].author).toBe("Unified author");
});

it("recovers a lost byline acknowledgement after restart and never lets an older feed overwrite a newer rename", async () => {
  const t = await pair();
  const id = await t.publish("cn");
  t.loseReply();
  expect(
    (
      await t.h.call("/api/auth/profile", t.cnCookie, "POST", {
        displayName: "First intent",
      })
    ).status,
  ).toBe(503);
  const restarted = t.restart();
  expect((await t.tick(restarted)).status).toBe(200);
  expect((await t.read("cn", id)).entry.author).toBe("First intent");

  expect((await t.rename("Older queued name")).status).toBe(200);
  const arrived = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const transport = t.h.region.fetchLike;
  let held = false;
  t.h.region.fetchLike = async (input, init) => {
    const response = await transport(input, init);
    if (String(input).endsWith("/bylines") && !held) {
      held = true;
      arrived.resolve();
      await release.promise;
    }
    return response;
  };
  const delayed = t.tick();
  await arrived.promise;
  expect(
    (
      await t.h.call("/api/auth/profile", t.cnCookie, "POST", {
        displayName: "Latest intent",
      })
    ).status,
  ).toBe(200);
  release.resolve();
  expect((await delayed).status).toBe(200);
  expect((await t.read("cn", id)).entry.author).toBe("Latest intent");
  expect((await t.tick()).status).toBe(200);
  expect((await t.read("cn", id)).entry.author).toBe("Latest intent");
});

it("seeds retained human profile names once through a private bounded feed and redacts retired names", async () => {
  const state = sqliteState();
  let active: InstanceType<typeof AuthDO>;
  const env = {
    RESEND_API_KEY: "rk",
    AUTH: {
      getByName: () => ({
        fetch: (input: string | Request, init?: RequestInit) =>
          active.fetch(new Request(input, init)),
      }),
    },
  };
  const old = (active = new AuthDO(state, env));
  const cookie = await signIn(old, "legacy-byline@example.com");
  const call = (
    auth: InstanceType<typeof AuthDO>,
    path: string,
    body: unknown,
    token = "",
  ) =>
    auth.fetch(
      new Request(transportOrigin + path, {
        method: "POST",
        headers: {
          authorization: token ? "Bearer " + token : "",
          cookie,
          origin: ORIGIN,
        },
        body: JSON.stringify(body),
      }),
    );
  const authorityConfig = JSON.stringify({
    ...JSON.parse(config),
    accountDeletion: true,
  });
  const upgraded = (active = new AuthDO(state, {
    ...env,
    AUTH_REGIONAL_AUTHORITY: authorityConfig,
  }));
  const path = "/api/auth/regional/bylines";
  expect((await call(upgraded, path, { after: 0 })).status).toBe(401);
  const seeded = await (
    await call(upgraded, path, { after: 0 }, secret)
  ).json();
  expect(seeded.jobs).toEqual([
    expect.objectContaining({
      displayName: "legacy-byline",
      sequence: 1,
      deleted: false,
    }),
  ]);
  const again = (active = new AuthDO(state, {
    ...env,
    AUTH_REGIONAL_AUTHORITY: authorityConfig,
  }));
  expect(await (await call(again, path, { after: 1 }, secret)).json()).toEqual({
    version: 1,
    head: 1,
    jobs: [],
  });
  expect(
    (
      await old.fetch(
        new Request(ORIGIN + "/api/auth/profile", {
          method: "POST",
          headers: { cookie, origin: ORIGIN },
          body: JSON.stringify({ displayName: "Rollback writer" }),
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (await (await call(again, path, { after: 1 }, secret)).json()).jobs,
  ).toEqual([
    expect.objectContaining({ displayName: "Rollback writer", sequence: 2 }),
  ]);
  const removal = await again.fetch(
    new Request(ORIGIN + "/api/auth/account/delete", {
      method: "POST",
      headers: { cookie, origin: ORIGIN },
      body: JSON.stringify({
        confirm: "delete-account",
        requestId: crypto.randomUUID(),
      }),
    }),
  );
  expect(removal.status).toBe(202);
  const retired = await (await call(again, path, { after: 0 }, secret)).json();
  expect(retired.jobs).toEqual([
    expect.objectContaining({ displayName: "", deleted: true }),
  ]);
  expect((await call(again, path, { after: 99 }, secret)).status).toBe(409);
});

it("retains the accepted regional rename intent while its source Gallery is unavailable and retries without another browser write", async () => {
  const t = await pair();
  const sourceId = await t.publish("overseas"),
    domesticId = await t.publish("cn");
  t.refuseSource(true);
  const response = await t.rename("Durable rename");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "byline-propagation-pending",
  });
  const me = await t.h.source.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/me", {
      headers: { cookie: t.sourceCookie },
    }),
  );
  expect((await me.json()).user.displayName).toBe("Durable rename");
  t.refuseSource(false);
  expect(
    (
      await t.h.source.authDurable.fetch(
        new Request("https://auth" + ACCOUNT_DELETION_TICK, { method: "POST" }),
      )
    ).status,
  ).toBe(200);
  expect((await t.tick()).status).toBe(200);
  expect((await t.read("overseas", sourceId)).entry.author).toBe(
    "Durable rename",
  );
  expect((await t.read("cn", domesticId)).entry.author).toBe("Durable rename");
});

it("keeps the newest authority name when an older regional session publishes after background catch-up", async () => {
  const t = await pair();
  const existing = await t.publish("cn");
  const renamed = await t.h.source.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/profile", {
      method: "POST",
      headers: { cookie: t.sourceCookie, origin: ORIGIN },
      body: JSON.stringify({ displayName: "Newest name" }),
    }),
  );
  expect(renamed.status).toBe(200);
  const tick = await t.h.region.fetch(
    new Request("https://auth" + ACCOUNT_DELETION_TICK, { method: "POST" }),
  );
  expect(tick.status).toBe(200);
  expect((await t.read("cn", existing)).entry.author).toBe("Newest name");
  const later = await t.publish("cn");
  expect((await t.read("cn", later)).entry.author).toBe("Newest name");
});
