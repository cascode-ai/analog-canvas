import { expect, it } from "vitest";
import { AuthDO, GalleryDO } from "./index";
import type { ReplicaConfig } from "./resource-replica";
import { RegionalSessionDO } from "./regional-session";
import { routeResourceSync } from "./resource-sync";
import { routeGalleryRequest } from "./gallery";
import { config } from "./regional-auth.test-support";
import {
  ORIGIN,
  signIn,
  sqliteState,
  submissionRequest,
  testbenchProjectText,
} from "./gallery.test-support";

it("drains only profile bylines in authenticated 50-row pages in both regions, preserving cursors across restart", async () => {
  const sourceState = sqliteState(),
    regionalState = {
      storage: {
        ...sqliteState().storage,
        setAlarm: async (_at: number) => {},
      },
    };
  const gallery = (region: "cn" | "overseas") => {
    const options: NonNullable<ConstructorParameters<typeof GalleryDO>[1]> &
      ReplicaConfig = {
      RESOURCE_REGION: region,
      RESOURCE_WRITES_ENABLED: "true",
    };
    const store = new GalleryDO(sqliteState(), options);
    return {
      getByName: () => ({
        fetch: (input: string, init?: RequestInit) =>
          store.fetch(new Request(input, init)),
      }),
    };
  };
  const sourceGallery = gallery("overseas"),
    cnGallery = gallery("cn");
  let authority: InstanceType<typeof AuthDO>;
  const sourceAuth = {
    getByName: () => ({
      fetch: (input: string, init?: RequestInit) =>
        authority.fetch(new Request(input, init)),
    }),
  };
  const sourceEnv = {
    AUTH: sourceAuth,
    GALLERY: sourceGallery,
    RESEND_API_KEY: "rk",
  };
  authority = new AuthDO(sourceState, sourceEnv);
  const retiring = await signIn(authority, "retiring-bootstrap@example.com");
  for (const GALLERY of [sourceGallery, cnGallery]) {
    const response = await routeGalleryRequest(
      submissionRequest(
        {
          name: "Queued before bootstrap",
          projectText: testbenchProjectText(),
        },
        { cookie: retiring },
      ),
      { AUTH: sourceAuth, GALLERY },
    );
    expect(response?.status).toBe(201);
    await GALLERY.getByName().fetch("https://gallery/simulation-checks-queue", {
      method: "POST",
      body: JSON.stringify({
        all: true,
        at: "2026-11-11T00:00:00Z",
        requestedBy: "bootstrap-owner",
      }),
    });
  }
  for (let index = 0; index < 50; index++)
    await signIn(authority, `bootstrap-${index}@example.com`);
  const enabled = JSON.stringify({
    ...JSON.parse(config),
    accountDeletion: true,
  });
  const restartSource = (withGallery = true) => {
    authority = new AuthDO(sourceState, {
      AUTH: sourceAuth,
      RESEND_API_KEY: "rk",
      ...(withGallery ? { GALLERY: sourceGallery } : {}),
      AUTH_REGIONAL_AUTHORITY: enabled,
    });
  };
  restartSource();
  let regional: RegionalSessionDO;
  const restartRegional = (withGallery = true) => {
    regional = new RegionalSessionDO(regionalState, {
      AUTH_REGIONAL_CLIENT: enabled,
      ...(withGallery ? { GALLERY: cnGallery } : {}),
    });
    regional.fetchLike = (async (input, init) =>
      authority.fetch(new Request(input, init))) as typeof fetch;
  };
  restartRegional();
  const regionalAuth = {
    getByName: () => ({
      fetch: (input: string, init?: RequestInit) =>
        regional.fetch(new Request(input, init)),
    }),
  };
  const deletionId = crypto.randomUUID();
  expect(
    (
      await authority.fetch(
        new Request(ORIGIN + "/api/auth/account/delete", {
          method: "POST",
          headers: { origin: ORIGIN, cookie: retiring },
          body: JSON.stringify({
            confirm: "delete-account",
            requestId: deletionId,
          }),
        }),
      )
    ).status,
  ).toBe(202);
  const next = (GALLERY: typeof sourceGallery) =>
    GALLERY.getByName()
      .fetch("https://gallery/simulation-check-next", {
        method: "POST",
        body: "{}",
      })
      .then((response) => response.json());
  const initialQueues = await Promise.all([
    next(sourceGallery),
    next(cnGallery),
  ]);
  expect(initialQueues.every((value) => value.job !== null)).toBe(true);
  const run = (
    region: "cn" | "overseas",
    token = "admin-only",
    method = "POST",
  ) =>
    routeResourceSync(
      new Request(ORIGIN + "/api/resource-sync/bylines/run", {
        method,
        headers: { authorization: "Bearer " + token },
      }),
      {
        RESOURCE_REGION: region,
        RESOURCE_SYNC_TOKEN: "read-only",
        RESOURCE_SYNC_ADMIN_TOKEN: "admin-only",
        AUTH: region === "cn" ? regionalAuth : sourceAuth,
      },
    );
  expect((await run("cn", "read-only"))?.status).toBe(401);
  expect((await run("overseas", ""))?.status).toBe(401);
  expect((await run("cn", "admin-only", "GET"))?.status).toBe(405);
  restartSource(false);
  restartRegional(false);
  for (const region of ["cn", "overseas"] as const) {
    const unavailable = await run(region);
    expect(unavailable?.status).toBe(503);
    expect(await unavailable?.json()).toEqual({ error: "byline-unavailable" });
  }
  restartSource();
  restartRegional();
  for (const region of ["cn", "overseas"] as const) {
    const first = await run(region);
    expect(first?.status).toBe(200);
    expect(await first?.json()).toEqual({
      status: "sent",
      head: 51,
      cursor: 50,
      sent: 50,
      caughtUp: false,
    });
  }
  restartSource();
  restartRegional();
  for (const region of ["cn", "overseas"] as const) {
    expect(await (await run(region))?.json()).toEqual({
      status: "sent",
      head: 51,
      cursor: 51,
      sent: 1,
      caughtUp: true,
    });
    expect(await (await run(region))?.json()).toEqual({
      status: "caught-up",
      head: 51,
      cursor: 51,
      sent: 0,
      caughtUp: true,
    });
  }
  const deletion = await authority.fetch(
    new Request(ORIGIN + "/api/auth/account/delete", {
      method: "POST",
      headers: { origin: ORIGIN },
      body: JSON.stringify({ statusOnly: true, requestId: deletionId }),
    }),
  );
  expect(await deletion.json()).toEqual({
    deletion: { requestId: deletionId, overseas: "pending", cn: "pending" },
  });
  expect(await Promise.all([next(sourceGallery), next(cnGallery)])).toEqual(
    initialQueues,
  );
});
