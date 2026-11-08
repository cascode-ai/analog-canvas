import { afterEach, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { gzipBody } from "./project-sync-http";
import type { ProjectEvent } from "./project-sync-journal";
import { RegionalProjectDO } from "./regional-projects";
import {
  environment,
  makerOf,
  ORIGIN,
  projectText,
  route,
  saveRequest,
  sqliteState,
} from "./gallery.test-support";

afterEach(() => vi.unstubAllGlobals());

it.each([
  { losePullReply: false, compressed: false },
  { losePullReply: true, compressed: false },
  { losePullReply: false, compressed: true },
])(
  "synchronizes both ways and recovers restarts (lost reply: $losePullReply, compressed journal: $compressed)",
  async ({ losePullReply, compressed }) => {
    const secret = "isolated-pull-authority-secret-for-test";
    const config = JSON.stringify({
      origin: ORIGIN,
      clientOrigin: "https://cn.test",
      secret,
    });
    const auth = environment({ AUTH_REGIONAL_AUTHORITY: config });
    const cookie = await makerOf(auth);
    const make = (region: "cn" | "overseas") => {
      const state = sqliteState();
      let store = new RegionalProjectDO(state, { PROJECT_REGION: region });
      return {
        env: {
          ...auth,
          PROJECT_SYNC_TOKEN: `${region}-peer`,
          PROJECT_SYNC_ADMIN_TOKEN: "test-admin",
          PROJECT_IDENTITY_URL: `${ORIGIN}/api/auth/regional/identities`,
          PROJECT_IDENTITY_TOKEN: secret,
          ...(region === "cn"
            ? {
                PROJECT_SYNC_PULL: "true",
                PROJECT_SYNC_PEER_URL: ORIGIN,
                PROJECT_SYNC_PEER_TOKEN: "overseas-peer",
              }
            : {}),
          PROJECTS: {
            getByName: () => ({
              fetch: (url: string, init?: RequestInit) =>
                store.fetch(new Request(url, init)),
            }),
          },
        },
        restart: (compress = false, migrateLegacyCounter = false) => {
          if (migrateLegacyCounter) {
            for (const event of ["insert", "update", "delete"])
              state.storage.sql.exec(`DROP TRIGGER project_sync_size_${event}`);
            state.storage.sql.exec("DROP TABLE project_sync_size");
          }
          store = new RegionalProjectDO(state, {
            PROJECT_REGION: region,
            PROJECT_SYNC_COMPRESS_JOURNAL: compress ? "true" : "false",
          });
        },
      };
    };
    const source = make("overseas"),
      domestic = make("cn");
    const created = await route(
      source.env,
      saveRequest(cookie, "Source draft"),
    );
    expect(created.status).toBe(201);
    const id = (await created.json()).project.id;
    let redirectPeer = true;
    const pushEncodings: (string | null)[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        // Match workerd: unsupported redirect modes fail before any request.
        if (init?.redirect === "error")
          throw new TypeError("Unsupported edge redirect mode");
        const request = new Request(input, init);
        expect(new URL(request.url).origin).toBe(ORIGIN);
        if (new URL(request.url).pathname === "/api/project-sync/events")
          pushEncodings.push(request.headers.get("content-encoding"));
        if (redirectPeer) {
          expect(request.redirect).toBe("manual");
          return Response.redirect("https://untrusted.test/collect", 302);
        }
        if (new URL(request.url).pathname === "/api/auth/regional/identities")
          return auth.authDurable.fetch(request);
        const response = await route(source.env, request);
        if (
          new URL(request.url).pathname === "/api/project-sync/pull" &&
          losePullReply
        ) {
          losePullReply = false;
          throw new Error("Pull reply lost after peer reconciliation");
        }
        return response;
      },
    );
    const tick = async () =>
      (
        await (
          await route(
            domestic.env,
            new Request("https://cn.test/api/project-sync/run", {
              method: "POST",
              headers: { Authorization: "Bearer test-admin" },
            }),
          )
        ).json()
      ).status;
    const open = async (env: typeof domestic.env) => {
      const response = await route(
        env,
        new Request(`${ORIGIN}/api/projects/${id}`, {
          headers: { Cookie: cookie },
        }),
      );
      expect(response.status).toBe(200);
      return (await response.json()).project;
    };
    expect(await tick()).toBe("blocked");
    redirectPeer = false;
    if (losePullReply) expect(await tick()).toBe("retry");
    expect(await tick()).toBe("sent");
    const current = await open(domestic.env);
    expect(current.name).toBe("Source draft");
    const journal = async (env: typeof domestic.env, suffix: string) =>
      (
        await route(
          env,
          new Request(`https://cn.test/api/project-sync/${suffix}`, {
            headers: { Authorization: `Bearer ${env.PROJECT_SYNC_TOKEN}` },
          }),
        )
      ).json();
    const legacyEvent = compressed
      ? (await journal(source.env, "events?after=0")).events[0]
      : null;
    if (compressed) {
      source.restart(true, true);
      domestic.restart(true, true);
      expect(await tick()).toBe("caught-up");
      expect((await journal(source.env, "status")).journalBytes).toBe(
        Buffer.byteLength(legacyEvent.payload),
      );
    }
    const before = await journal(domestic.env, "status");
    const saved = await route(
      domestic.env,
      new Request(`${ORIGIN}/api/projects/${id}`, {
        method: "PUT",
        headers: {
          Cookie: cookie,
          Origin: ORIGIN,
          "If-Match": current.saveToken,
        },
        body: JSON.stringify({
          name: "Domestic acknowledged",
          projectText: projectText("Domestic acknowledged"),
        }),
      }),
    );
    expect(saved.status).toBe(200);
    const newEventPath = `events?after=${before.sequence}`;
    const newEvent = compressed
      ? (await journal(domestic.env, newEventPath)).events[0]
      : null;
    if (newEvent) {
      const after = await journal(domestic.env, "status");
      expect(after.journalBytes - before.journalBytes).toBe(
        gzipSync(newEvent.payload, { level: 1 }).byteLength,
      );
    }
    expect(await tick()).toBe("sent");
    expect((await open(source.env)).name).toBe("Domestic acknowledged");
    domestic.restart();
    expect(await tick()).toBe("caught-up");
    expect((await open(domestic.env)).name).toBe("Domestic acknowledged");
    expect((await open(source.env)).saveToken).toBe(
      (await open(domestic.env)).saveToken,
    );
    source.restart();
    expect(await tick()).toBe("caught-up");
    expect((await open(source.env)).name).toBe("Domestic acknowledged");
    if (compressed) {
      expect((await journal(source.env, "events?after=0")).events[0]).toEqual(
        legacyEvent,
      );
      expect((await journal(domestic.env, newEventPath)).events[0]).toEqual(
        newEvent,
      );
      const position = ({ epoch, sequence, payloadHash }: ProjectEvent) => ({
        epoch,
        sequence,
        hash: payloadHash,
      });
      const checkpoint = {
        cn: position(newEvent),
        overseas: position(legacyEvent),
      };
      const compact = (
        env: typeof domestic.env,
        dryRun: boolean,
        proof = checkpoint,
      ) =>
        route(
          env,
          new Request(`${ORIGIN}/api/project-sync/compact`, {
            method: "POST",
            headers: { Authorization: "Bearer test-admin" },
            body: JSON.stringify({ checkpoint: proof, dryRun }),
          }),
        );
      for (const env of [source.env, domestic.env]) {
        const start = await journal(env, "status");
        const wrongCheckpoint = {
          ...checkpoint,
          overseas: { ...checkpoint.overseas, hash: "0".repeat(64) },
        };
        expect((await compact(env, false, wrongCheckpoint)).status).toBe(409);
        const preview = await compact(env, true);
        expect(preview.status).toBe(200);
        expect(await preview.json()).toMatchObject({
          events: 1,
          bytes: Buffer.byteLength(legacyEvent.payload),
        });
        expect((await journal(env, "status")).journalBytes).toBe(
          start.journalBytes,
        );
        const applied = await compact(env, false);
        expect(applied.status).toBe(200);
        expect(await applied.json()).toMatchObject({ events: 1 });
        expect((await journal(env, "status")).journalBytes).toBe(
          start.journalBytes - Buffer.byteLength(legacyEvent.payload),
        );
      }
      expect(await journal(source.env, "events?after=0")).toMatchObject({
        error: "compacted-cursor",
        floor: 1,
      });
      const currentPeer = await journal(domestic.env, "status");
      const stalePull = await route(
        source.env,
        new Request(`${ORIGIN}/api/project-sync/pull`, {
          method: "POST",
          headers: { Authorization: "Bearer overseas-peer" },
          body: JSON.stringify({ status: { ...currentPeer, received: null } }),
        }),
      );
      expect(stalePull.status).toBe(409);
      expect(await stalePull.json()).toMatchObject({
        error: "compacted-cursor",
      });
      expect((await journal(source.env, "status")).fenced).toBe(false);
      source.restart();
      domestic.restart();
      expect(await tick()).toBe("caught-up");
      const retry = await route(
        domestic.env,
        new Request(`${ORIGIN}/api/project-sync/events`, {
          method: "POST",
          headers: { Authorization: "Bearer cn-peer" },
          body: JSON.stringify({ event: legacyEvent }),
        }),
      );
      expect(retry.status).toBe(200);
      const versions = `${ORIGIN}/api/projects/${id}/versions`;
      const headers = { Cookie: cookie };
      const history = await (
        await route(domestic.env, new Request(versions, { headers }))
      ).json();
      expect(history.versions).toHaveLength(1);
      const prior = await route(
        domestic.env,
        new Request(`${versions}/${history.versions[0].versionId}/project`, {
          headers,
        }),
      );
      expect(prior.status).toBe(200);
      expect((await prior.json()).projectText).toBe(current.projectText);

      for (const [env, name] of [
        [source.env, "Concurrent overseas edit"],
        [domestic.env, "Concurrent domestic edit"],
      ] as const) {
        const { saveToken } = await open(env);
        const edited = await route(
          env,
          new Request(`${ORIGIN}/api/projects/${id}`, {
            method: "PUT",
            headers: { Cookie: cookie, Origin: ORIGIN, "If-Match": saveToken },
            body: JSON.stringify({ name, projectText: projectText(name) }),
          }),
        );
        expect(edited.status).toBe(200);
      }
      expect(await tick()).toBe("sent");
      expect(await tick()).toBe("caught-up");
      const conflictCheckpoint = {
        cn: position((await journal(domestic.env, "events?after=1")).events[0]),
        overseas: position(
          (await journal(source.env, "events?after=1")).events[0],
        ),
      };
      for (const env of [source.env, domestic.env]) {
        const applied = await compact(env, false, conflictCheckpoint);
        expect(applied.status).toBe(200);
        expect(await applied.json()).toMatchObject({ events: 1 });
        const openConflict = await route(
          env,
          new Request(`${ORIGIN}/api/projects/${id}`, { headers }),
        );
        expect(openConflict.status).toBe(409);
        const { conflicts } = await openConflict.json();
        expect(
          conflicts.map((branch: { name: string }) => branch.name).sort(),
        ).toEqual(["Concurrent domestic edit", "Concurrent overseas edit"]);
      }
    }
    const refused = await route(
      source.env,
      new Request(`${ORIGIN}/api/project-sync/pull`, {
        method: "POST",
        body: "{}",
      }),
    );
    expect(refused.status).toBe(401);
    // Pushes cross the border gzipped; receivers bound the inflated size.
    expect(pushEncodings).toContain("gzip");
    const inflated = await route(
      source.env,
      new Request(`${ORIGIN}/api/project-sync/pull`, {
        method: "POST",
        headers: {
          Authorization: "Bearer overseas-peer",
          "Content-Encoding": "gzip",
        },
        body: await gzipBody(JSON.stringify({ status: "a".repeat(8192) })),
      }),
    );
    expect(inflated.status).toBe(413);
  },
);
