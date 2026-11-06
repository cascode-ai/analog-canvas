import { expect, it } from "vitest";
import { RegionalSessionDO } from "./regional-session";
import {
  adminOf,
  makerOf,
  ownerAccountOf,
  ORIGIN,
  projectText,
  route,
  seatOf,
} from "./gallery.test-support";

import {
  accounts,
  config,
  secret,
  transportOrigin,
} from "./regional-auth.test-support";

it("retains administrator role controls through the grant and refreshes affected sessions by alarm", async () => {
  const h = accounts();
  const admin = await h.connect(await adminOf(h.source));
  const member = await h.connect(await makerOf(h.source));
  const setRole = (cookie: string, role: string) =>
    h.call("/api/auth/users/role", cookie, "POST", {
      email: "maker@example.com",
      role,
    });
  expect((await setRole(member, "moderator")).status).toBe(401);
  expect((await setRole(admin, "moderator")).status).toBe(200);
  h.advance(30_000);
  await h.region.alarm();
  expect(
    (await (await h.call("/api/auth/me", member)).json()).user,
  ).toMatchObject({ role: "moderator", isAdmin: false });
  expect((await h.call("/api/auth/admin/stats", member)).status).toBe(401);
  expect(
    (await (await h.call("/api/auth/admin/stats", admin)).json())
      .registeredAccounts,
  ).toBe(2);
  expect((await setRole(admin, "user")).status).toBe(200);
  h.advance(30_000);
  await h.region.alarm();
  expect((await (await h.call("/api/auth/me", member)).json()).user.role).toBe(
    "user",
  );
});

it("changes the authoritative profile through a domestic session and immediately refreshes its local view", async () => {
  const h = accounts();
  const sourceCookie = await makerOf(h.source);
  const localCookie = await h.connect(sourceCookie);
  const before = await (await h.call("/api/auth/me", localCookie)).json();
  const response = await h.call("/api/auth/profile", localCookie, "POST", {
    displayName: "Domestic maker",
  });
  expect(response.status).toBe(200);
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(await response.json()).toEqual({
    user: { ...before.user, displayName: "Domestic maker" },
  });
  expect(
    (await (await h.call("/api/auth/me", localCookie)).json()).user,
  ).toEqual({ ...before.user, displayName: "Domestic maker" });
  const overseas = await h.source.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/me", { headers: { cookie: sourceCookie } }),
  );
  expect((await overseas.json()).user).toEqual({
    ...before.user,
    displayName: "Domestic maker",
  });
});

it("manages Owner tokens domestically and validates them only for Dataset import without caching revocation", async () => {
  const h = accounts();
  const owner = await h.connect(await ownerAccountOf(h.source));
  const admin = await h.connect(await adminOf(h.source));
  const member = await h.connect(await makerOf(h.source));
  for (const cookie of [admin, member])
    expect(
      (
        await h.call("/api/auth/owner-tokens", cookie, "POST", {
          label: "denied",
        })
      ).status,
    ).toBe(403);
  const minted = await h.call("/api/auth/owner-tokens", owner, "POST", {
    label: "regional import",
  });
  expect(minted.status).toBe(201);
  const { id, token } = await minted.json();
  const listed = await (await h.call("/api/auth/owner-tokens", owner)).json();
  expect(listed.tokens).toEqual([
    expect.objectContaining({ id, label: "regional import" }),
  ]);
  expect(JSON.stringify(listed)).not.toContain(token);
  const importing = (bearer: string) =>
    route(
      h.resources,
      new Request(ORIGIN + "/api/gallery/sources/analoggenie/entries", {
        method: "POST",
        headers: {
          authorization: "Bearer " + bearer,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          entries: [
            {
              id: "ag-1974",
              name: "Synthetic import",
              projectText: projectText(),
            },
          ],
        }),
      }),
    );
  expect((await importing(token)).status).toBe(200);
  expect(
    (
      await h.region.fetch(
        new Request(ORIGIN + "/api/auth/owner-tokens", {
          method: "POST",
          headers: { origin: ORIGIN, authorization: "Bearer " + token },
          body: JSON.stringify({ label: "escalation" }),
        }),
      )
    ).status,
  ).toBe(401);
  expect(
    await (
      await h.region.fetch(
        new Request(ORIGIN + "/api/auth/me", {
          headers: { authorization: "Bearer " + token },
        }),
      )
    ).json(),
  ).toEqual({ user: null, authorization: "anonymous" });
  expect(
    (await h.call("/api/auth/owner-tokens/" + id, owner, "DELETE")).status,
  ).toBe(200);
  expect((await importing(token)).status).toBe(401);
});

it.each([false, true])(
  "ignores a renewal arriving after a profile change (invalidated in transit: %s)",
  async (invalidated) => {
    const h = accounts();
    const cookie = await h.connect(await makerOf(h.source));
    let release!: () => void;
    let captured!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      captured = resolve;
    });
    h.region.fetchLike = (async (input, init) => {
      const isRenewal = String(input).endsWith("/renew");
      const response = await h.source.authDurable.fetch(
        new Request(
          input,
          isRenewal && invalidated
            ? { ...init, body: JSON.stringify({ grant: "x".repeat(43) }) }
            : init,
        ),
      );
      if (String(input).endsWith("/renew")) {
        captured();
        await delayed;
      }
      return response;
    }) as typeof fetch;
    h.advance(30_000);
    const renewing = h.region.alarm();
    await ready;
    expect(
      (
        await h.call("/api/auth/profile", cookie, "POST", {
          displayName: "New profile",
        })
      ).status,
    ).toBe(200);
    release();
    await renewing;
    expect(
      (await (await h.call("/api/auth/me", cookie)).json()).user.displayName,
    ).toBe("New profile");
  },
);

it("orders a profile write delayed before dispatch ahead of an overlapping account read", async () => {
  const h = accounts();
  const cookie = await h.connect(await ownerAccountOf(h.source));
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const completed: string[] = [];
  h.region.fetchLike = (async (input, init) => {
    const path = JSON.parse(String(init?.body)).path as string | undefined;
    if (path === "/api/auth/profile") {
      ready.resolve();
      await release.promise;
    }
    const response = await h.source.authDurable.fetch(new Request(input, init));
    if (path) completed.push(path);
    return response;
  }) as typeof fetch;
  const changing = h.call("/api/auth/profile", cookie, "POST", {
    displayName: "After dispatch",
  });
  await ready.promise;
  const listing = h.call("/api/auth/owner-tokens", cookie);
  // Local reads remain available while an authority mutation is in flight.
  expect(
    (await (await h.call("/api/auth/me", cookie)).json()).user.displayName,
  ).not.toBe("After dispatch");
  release.resolve();
  expect((await changing).status).toBe(200);
  expect((await listing).status).toBe(200);
  expect(completed).toEqual(["/api/auth/profile", "/api/auth/owner-tokens"]);
  expect(
    (await (await h.call("/api/auth/me", cookie)).json()).user.displayName,
  ).toBe("After dispatch");
});

it("cancels queued account work when logout occurs during another account request", async () => {
  const h = accounts();
  const cookie = await h.connect(await ownerAccountOf(h.source));
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  h.region.fetchLike = (async (input, init) => {
    const response = await h.source.authDurable.fetch(new Request(input, init));
    if (String(input).endsWith("/account")) {
      ready.resolve();
      await release.promise;
    }
    return response;
  }) as typeof fetch;
  const changing = h.call("/api/auth/profile", cookie, "POST", {
    displayName: "Leaving",
  });
  await ready.promise;
  const listing = h.call("/api/auth/owner-tokens", cookie);
  expect((await h.call("/api/auth/logout", cookie, "POST")).status).toBe(200);
  release.resolve();
  expect((await changing).status).toBe(401);
  expect((await listing).status).toBe(401);
});

it("switches only the regional grant to an AI account and preserves its original actor and overseas session", async () => {
  const h = accounts();
  const sourceCookie = await adminOf(h.source);
  const cookie = await h.connect(sourceCookie);
  const actor = (await (await h.call("/api/auth/me", cookie)).json()).user;
  const listed = await h.call("/api/auth/ai-accounts", cookie);
  expect(listed.status).toBe(200);
  const { accounts: seats } = await listed.json();
  const seat = seats[0];
  const switched = await h.call(
    "/api/auth/ai-accounts/switch",
    cookie,
    "POST",
    { userId: seat.id },
  );
  expect(switched.status).toBe(200);
  expect(switched.headers.getSetCookie()).toEqual([]);
  expect(
    (await (await h.call("/api/auth/me", cookie)).json()).user,
  ).toMatchObject({
    id: seat.id,
    isAdmin: false,
    switchedFrom: { id: actor.id, displayName: actor.displayName },
  });
  const overseas = () =>
    h.source.authDurable.fetch(
      new Request(ORIGIN + "/api/auth/me", {
        headers: { cookie: sourceCookie },
      }),
    );
  expect((await (await overseas()).json()).user).toEqual(actor);
  expect(
    (
      await h.call("/api/auth/users/role", cookie, "POST", {
        email: "maker@example.com",
        role: "moderator",
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await h.call("/api/auth/owner-tokens", cookie, "POST", {
        label: "escalation",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await h.call("/api/auth/profile", cookie, "POST", {
        displayName: "escalation",
      })
    ).status,
  ).toBe(409);
  h.advance(30_000);
  await h.region.alarm();
  expect(
    (await (await h.call("/api/auth/me", cookie)).json()).user.switchedFrom.id,
  ).toBe(actor.id);
  expect(
    (await h.call("/api/auth/ai-accounts/return", cookie, "POST", {})).status,
  ).toBe(200);
  expect((await (await h.call("/api/auth/me", cookie)).json()).user).toEqual(
    actor,
  );
  expect((await (await overseas()).json()).user).toEqual(actor);
});

it("retains the original actor when an overseas AI session starts a regional handoff", async () => {
  const h = accounts();
  const admin = await adminOf(h.source);
  const sourceCall = (
    path: string,
    cookie: string,
    method = "GET",
    body?: unknown,
  ) =>
    h.source.authDurable.fetch(
      new Request(ORIGIN + path, {
        method,
        headers: { cookie, origin: ORIGIN },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const actor = (await (await sourceCall("/api/auth/me", admin)).json()).user;
  const { accounts: seats } = await (
    await sourceCall("/api/auth/ai-accounts", admin)
  ).json();
  const switched = await sourceCall(
    "/api/auth/ai-accounts/switch",
    admin,
    "POST",
    { userId: seats[0].id },
  );
  const sourceCookie = switched.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const cookie = await h.connect(sourceCookie);
  expect(
    (await (await h.call("/api/auth/me", cookie)).json()).user,
  ).toMatchObject({
    id: seats[0].id,
    switchedFrom: { id: actor.id, displayName: actor.displayName },
  });
  expect(
    (await h.call("/api/auth/ai-accounts/return", cookie, "POST", {})).status,
  ).toBe(200);
  expect((await (await h.call("/api/auth/me", cookie)).json()).user).toEqual(
    actor,
  );
  expect(
    (await (await sourceCall("/api/auth/me", sourceCookie)).json()).user.id,
  ).toBe(seats[0].id);
});

it("refuses an overseas AI handoff without a live original actor", async () => {
  const h = accounts();
  const sourceCookie = await seatOf(h.source);
  const start = await h.call("/api/auth/regional/start", "");
  const url = new URL(start.headers.get("location")!);
  const response = await h.source.authDurable.fetch(
    new Request(transportOrigin + url.pathname + url.search, {
      headers: { cookie: sourceCookie },
    }),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "original-actor-required" });
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(
    (
      await (
        await h.source.authDurable.fetch(
          new Request(ORIGIN + "/api/auth/me", {
            headers: { cookie: sourceCookie },
          }),
        )
      ).json()
    ).user.seat,
  ).toBeTruthy();
});

it("upgrades an existing human session before its first AI switch and bodyless return", async () => {
  const h = accounts();
  const cookie = await h.connect(await adminOf(h.source));
  const actor = (await (await h.call("/api/auth/me", cookie)).json()).user;
  const { accounts: seats } = await (
    await h.call("/api/auth/ai-accounts", cookie)
  ).json();
  // Arrange the previous persisted schema, then exercise only public routes.
  h.state.storage.sql.exec(
    "ALTER TABLE regional_sessions DROP COLUMN actor_id",
  );
  const migrated = new RegionalSessionDO(h.state, {
    AUTH_REGIONAL_CLIENT: config,
  });
  migrated.now = h.region.now;
  migrated.fetchLike = h.region.fetchLike;
  const call = (path: string, method = "GET", body?: unknown) =>
    migrated.fetch(
      new Request(ORIGIN + path, {
        method,
        headers: { cookie, origin: ORIGIN },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  expect(
    (
      await call("/api/auth/ai-accounts/switch", "POST", {
        userId: seats[0].id,
      })
    ).status,
  ).toBe(200);
  h.advance(30_000);
  await migrated.alarm();
  expect((await call("/api/auth/ai-accounts/return", "POST")).status).toBe(200);
  expect((await (await call("/api/auth/me")).json()).user).toEqual(actor);
});

it.each([false, true])(
  "fences an older renewal across an AI switch (rejected renewal: %s)",
  async (rejected) => {
    const h = accounts();
    const cookie = await h.connect(await adminOf(h.source));
    const { accounts: seats } = await (
      await h.call("/api/auth/ai-accounts", cookie)
    ).json();
    const ready = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    h.region.fetchLike = (async (input, init) => {
      const renewing = String(input).endsWith("/renew");
      const response = await h.source.authDurable.fetch(
        new Request(
          input,
          renewing && rejected
            ? { ...init, body: JSON.stringify({ grant: "x".repeat(43) }) }
            : init,
        ),
      );
      if (renewing) {
        ready.resolve();
        await release.promise;
      }
      return response;
    }) as typeof fetch;
    h.advance(30_000);
    const renewal = h.region.alarm();
    await ready.promise;
    expect(
      (
        await h.call("/api/auth/ai-accounts/switch", cookie, "POST", {
          userId: seats[0].id,
        })
      ).status,
    ).toBe(200);
    release.resolve();
    await renewal;
    expect((await (await h.call("/api/auth/me", cookie)).json()).user.id).toBe(
      seats[0].id,
    );
  },
);

it.each([false, true])(
  "fails closed during an upgraded session's switch and recovers a lost reply after restart (logout: %s)",
  async (logout) => {
    const h = accounts();
    const cookie = await h.connect(await adminOf(h.source));
    const { accounts: seats } = await (
      await h.call("/api/auth/ai-accounts", cookie)
    ).json();
    // A migrated pre-AI row has no actor binding until its first successful refresh.
    h.state.storage.sql.exec("UPDATE regional_sessions SET actor_id = NULL");
    const ready = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    h.region.fetchLike = (async (input, init) => {
      await h.source.authDurable.fetch(new Request(input, init));
      ready.resolve();
      await release.promise;
      throw new Error("Lost authority response");
    }) as typeof fetch;
    const switching = h.call("/api/auth/ai-accounts/switch", cookie, "POST", {
      userId: seats[0].id,
    });
    await ready.promise;
    expect(
      (await (await h.call("/api/auth/me", cookie)).json()).authorization,
    ).toBe("expired");
    if (logout)
      expect((await h.call("/api/auth/logout", cookie, "POST")).status).toBe(
        200,
      );
    release.resolve();
    expect((await switching).status).toBe(503);
    h.advance(30_000);
    const restarted = new RegionalSessionDO(h.state, {
      AUTH_REGIONAL_CLIENT: config,
    });
    restarted.now = h.region.now;
    restarted.fetchLike = (async (input, init) =>
      h.source.authDurable.fetch(new Request(input, init))) as typeof fetch;
    await restarted.alarm();
    const result = await (
      await restarted.fetch(
        new Request(ORIGIN + "/api/auth/me", { headers: { cookie } }),
      )
    ).json();
    if (logout) expect(result.user).toBeNull();
    else {
      expect(result.user).toMatchObject({
        id: seats[0].id,
        switchedFrom: { id: expect.any(String) },
      });
      expect(
        (
          await restarted.fetch(
            new Request(ORIGIN + "/api/auth/ai-accounts/return", {
              method: "POST",
              headers: { cookie, origin: ORIGIN },
            }),
          )
        ).status,
      ).toBe(200);
    }
  },
);

it("rejects return and renewal after the AI actor's authority session is revoked", async () => {
  const h = accounts();
  const sourceCookie = await adminOf(h.source);
  const cookie = await h.connect(sourceCookie);
  const { accounts: seats } = await (
    await h.call("/api/auth/ai-accounts", cookie)
  ).json();
  expect(
    (
      await h.call("/api/auth/ai-accounts/switch", cookie, "POST", {
        userId: seats[0].id,
      })
    ).status,
  ).toBe(200);
  await h.source.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/logout", {
      method: "POST",
      headers: { cookie: sourceCookie, origin: ORIGIN },
    }),
  );
  expect(
    (await h.call("/api/auth/ai-accounts/return", cookie, "POST", {})).status,
  ).toBe(401);
  h.advance(30_000);
  await h.region.alarm();
  expect((await (await h.call("/api/auth/me", cookie)).json()).user).toBeNull();
});

it("rejects cross-site changes, forged identities and unscoped account calls", async () => {
  const h = accounts();
  const sourceCookie = await makerOf(h.source);
  const cookie = await h.connect(sourceCookie);
  const before = (await (await h.call("/api/auth/me", cookie)).json()).user;
  for (const headers of [
    { origin: "https://attacker.test" },
    { origin: ORIGIN, "sec-fetch-site": "cross-site" },
  ]) {
    expect(
      (
        await h.region.fetch(
          new Request(ORIGIN + "/api/auth/profile", {
            method: "POST",
            headers: { ...headers, cookie },
            body: JSON.stringify({ displayName: "Forged" }),
          }),
        )
      ).status,
    ).toBe(403);
  }
  expect(
    (
      await h.call("/api/auth/profile", sourceCookie, "POST", {
        displayName: "Forged",
      })
    ).status,
  ).toBe(401);
  expect(
    (await h.call("/api/auth/profile", cookie, "POST", { displayName: "" }))
      .status,
  ).toBe(400);
  expect(
    (
      await h.call("/api/auth/profile", cookie, "POST", {
        displayName: "x".repeat(17_000),
      })
    ).status,
  ).toBe(400);
  const forged = await h.call("/api/auth/profile", cookie, "POST", {
    displayName: "Real maker",
    user: { id: "other", isAdmin: true },
    headers: { cookie: "icm_session=fake" },
  });
  expect((await forged.json()).user).toEqual({
    ...before,
    displayName: "Real maker",
  });
  const rpc = (path: string, authorization: string) =>
    h.source.authDurable.fetch(
      new Request(transportOrigin + "/api/auth/regional/account", {
        method: "POST",
        headers: { authorization },
        body: JSON.stringify({
          grant: "x".repeat(43),
          method: "POST",
          path,
          body: {},
        }),
      }),
    );
  expect((await rpc("/api/auth/profile", "")).status).toBe(401);
  expect((await rpc("/api/auth/profile", "Bearer " + secret)).status).toBe(401);
  for (const path of [
    "https://attacker.test/",
    "/internal/session-user",
    "/api/auth/logout",
    "/api/auth/profile/",
    "/api/auth/profile?user=other",
  ])
    expect((await rpc(path, "Bearer " + secret)).status).toBe(404);
  expect(
    (await h.call("/api/auth/regional/account", cookie, "POST", {})).status,
  ).toBe(404);
  await h.source.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/logout", {
      method: "POST",
      headers: { origin: ORIGIN, cookie: sourceCookie },
    }),
  );
  expect(
    (
      await h.call("/api/auth/profile", cookie, "POST", {
        displayName: "Revoked",
      })
    ).status,
  ).toBe(401);
  expect((await (await h.call("/api/auth/me", cookie)).json()).user).toBeNull();
});

it("does not restore a logged-out session when its pending account response arrives", async () => {
  const h = accounts();
  const cookie = await h.connect(await makerOf(h.source));
  const delayed = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  h.region.fetchLike = (async (input, init) => {
    const response = await h.source.authDurable.fetch(new Request(input, init));
    if (String(input).endsWith("/account")) {
      ready.resolve();
      await delayed.promise;
    }
    return response;
  }) as typeof fetch;
  const rename = h.call("/api/auth/profile", cookie, "POST", {
    displayName: "Before logout",
  });
  await ready.promise;
  expect((await h.call("/api/auth/logout", cookie, "POST")).status).toBe(200);
  delayed.resolve();
  expect((await rename).status).toBe(401);
  expect((await (await h.call("/api/auth/me", cookie)).json()).user).toBeNull();
});

it("does not extend authorization when account transport fails or redirects", async () => {
  const h = accounts();
  const cookie = await h.connect(await makerOf(h.source));
  h.region.fetchLike = (async (_input, init) => {
    expect(init?.redirect).toBe("manual");
    return new Response(null, {
      status: 302,
      headers: { location: "https://attacker.test/" },
    });
  }) as typeof fetch;
  h.advance(30_000);
  expect(
    (
      await h.call("/api/auth/profile", cookie, "POST", {
        displayName: "Redirected",
      })
    ).status,
  ).toBe(503);
  h.region.fetchLike = async () => {
    throw new Error("offline");
  };
  h.advance(30_001);
  await h.region.alarm();
  expect(await (await h.call("/api/auth/me", cookie)).json()).toEqual({
    user: null,
    authorization: "expired",
  });
  expect(
    (
      await h.call("/api/auth/profile", cookie, "POST", {
        displayName: "Offline",
      })
    ).status,
  ).toBe(401);
});

it("returns a newly minted token even when another tab lists tokens before its response arrives", async () => {
  const h = accounts();
  const cookie = await h.connect(await ownerAccountOf(h.source));
  const delayed = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  let first = true;
  h.region.fetchLike = (async (input, init) => {
    const response = await h.source.authDurable.fetch(new Request(input, init));
    if (String(input).endsWith("/account") && first) {
      first = false;
      ready.resolve();
      await delayed.promise;
    }
    return response;
  }) as typeof fetch;
  const minting = h.call("/api/auth/owner-tokens", cookie, "POST", {
    label: "overlapping mint",
  });
  await ready.promise;
  const listing = h.call("/api/auth/owner-tokens", cookie);
  delayed.resolve();
  const minted = await minting;
  const list = await listing;
  expect(list.status).toBe(200);
  expect(minted.status).toBe(201);
  const result = await minted.json();
  expect(result.token).toMatch(/^acot_/);
  expect((await list.json()).tokens).toContainEqual(
    expect.objectContaining({ id: result.id }),
  );
  expect(
    (await h.call("/api/auth/owner-tokens/" + result.id, cookie, "DELETE"))
      .status,
  ).toBe(200);
});

it("lists and revokes an existing Owner token collection larger than the request body limit", async () => {
  const h = accounts();
  const sourceCookie = await ownerAccountOf(h.source);
  for (let index = 0; index < 150; index++) {
    const response = await h.source.authDurable.fetch(
      new Request(ORIGIN + "/api/auth/owner-tokens", {
        method: "POST",
        headers: { cookie: sourceCookie, origin: ORIGIN },
        body: JSON.stringify({ label: "Existing machine " + index }),
      }),
    );
    expect(response.status).toBe(201);
  }
  const sourceList = await h.source.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/owner-tokens", {
      headers: { cookie: sourceCookie, origin: ORIGIN },
    }),
  );
  const sourceText = await sourceList.text();
  expect(new TextEncoder().encode(sourceText).byteLength).toBeGreaterThan(
    16_384,
  );
  const cookie = await h.connect(sourceCookie);
  const listed = await h.call("/api/auth/owner-tokens", cookie);
  expect(listed.status).toBe(200);
  const payload = await listed.json();
  expect(payload).toEqual(JSON.parse(sourceText));
  expect(
    (
      await h.call(
        "/api/auth/owner-tokens/" + payload.tokens[0].id,
        cookie,
        "DELETE",
      )
    ).status,
  ).toBe(200);
  expect(
    (await (await h.call("/api/auth/owner-tokens", cookie)).json()).tokens,
  ).toHaveLength(149);
});

it.each([false, true])(
  "checks the current authorization after a slow POST body (expired: %s)",
  async (expired) => {
    const h = accounts();
    const cookie = await h.connect(await ownerAccountOf(h.source));
    const ready = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          ready.resolve();
          await resume.promise;
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ displayName: "Slow body" }),
            ),
          );
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const updating = h.region.fetch(
      new Request(ORIGIN + "/api/auth/profile", {
        method: "POST",
        headers: { origin: ORIGIN, cookie },
        body,
        ...{ duplex: "half" },
      }),
    );
    await ready.promise;
    expect((await h.call("/api/auth/owner-tokens", cookie)).status).toBe(200);
    if (expired) h.advance(60_001);
    resume.resolve();
    expect((await updating).status).toBe(expired ? 401 : 200);
  },
);
