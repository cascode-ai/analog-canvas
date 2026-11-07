import { afterEach, expect, it, vi } from "vitest";
import { gzipBody } from "./project-sync-http";
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
        restart: (compress = false) => {
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
    const journal = async (suffix: string) =>
      (
        await route(
          domestic.env,
          new Request(`https://cn.test/api/project-sync/${suffix}`, {
            headers: { Authorization: "Bearer cn-peer" },
          }),
        )
      ).json();
    if (compressed) {
      source.restart(true);
      domestic.restart(true);
      expect(await tick()).toBe("caught-up");
    }
    const before = await journal("status");
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
    if (compressed) {
      const after = await journal("status");
      const { events } = await journal(`events?after=${before.sequence}`);
      expect(after.journalBytes - before.journalBytes).toBeLessThan(
        Buffer.byteLength(events[0].payload),
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
