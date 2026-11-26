import { afterEach, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import entry from "./regional-entry";
import { regionalRuntimeBindings } from "./regional-entry.test-support";
import { RegionalProjectDO } from "./regional-projects";
import { RegionalSessionDO } from "./regional-session";
import {
  environment,
  adminOf,
  makerOf,
  route,
  saveRequest,
  sqliteState,
  ORIGIN,
  projectText,
  submitOne,
  wiredProjectText,
} from "./gallery.test-support";

afterEach(() => vi.unstubAllGlobals());

async function publishedRegionalCircuit() {
  const origin = "https://cn.test";
  const source = environment();
  const cookie = await adminOf(source);
  const id = await submitOne(source, "Published circuit", {
    cookie,
    text: wiredProjectText(),
  });
  const target = {
    ...source,
    AUTH: source.AUTH!,
    ...regionalRuntimeBindings(),
    AUTH_REGIONAL_CLIENT: JSON.stringify({
      origin: ORIGIN,
      clientOrigin: origin,
      secret: "isolated-gallery-compression-service-secret",
    }),
  };
  return { source, cookie, id, origin, target };
}

it("compresses a public preview after checking its current visibility", async () => {
  const { source, cookie, id, origin, target } =
    await publishedRegionalCircuit();
  const detail = await entry.fetch(
    new Request(`${origin}/api/gallery/${id}?summary=1`),
    target,
  );
  const { entry: published } = await detail.json();
  const preview = `${origin}/api/gallery/${id}/preview.svg?v=${published.previewRevision}`;
  const read = (encoding: string) =>
    entry.fetch(
      new Request(preview, { headers: { "accept-encoding": encoding } }),
      target,
    );
  const plain = await read("identity");
  const compressed = await read("gzip");
  expect(compressed.status).toBe(200);
  expect(compressed.headers.get("content-encoding")).toBe("gzip");
  expect(compressed.headers.get("vary")).toBe("Accept-Encoding");
  expect(compressed.headers.get("cache-control")).toBe(
    plain.headers.get("cache-control"),
  );
  expect(
    gunzipSync(new Uint8Array(await compressed.arrayBuffer())).toString(),
  ).toBe(await plain.text());

  const withdrawal = await route(
    source,
    new Request(`${ORIGIN}/api/gallery/${id}/recycle`, {
      method: "POST",
      headers: { origin: ORIGIN, cookie },
    }),
  );
  expect(withdrawal.status).toBe(200);
  const withdrawn = await read("gzip");
  expect(withdrawn.status).toBe(404);
  expect(withdrawn.headers.has("content-encoding")).toBe(false);
});

it("negotiates public bulk downloads and preserves the curator's private response", async () => {
  const { cookie, id, origin, target } = await publishedRegionalCircuit();
  const path = `${origin}/api/gallery/${id}?download=1`;
  const download = (headers: HeadersInit) =>
    entry.fetch(new Request(path, { headers }), target);
  const identity = await download({ "accept-encoding": "*;q=1, gzip;q=0" });
  const raw = await identity.text();
  expect(identity.headers.has("content-encoding")).toBe(false);
  expect(JSON.parse(raw)).not.toHaveProperty("submitterEmail");
  const preferredIdentity = await download({
    "accept-encoding": "gzip;q=0.1, identity;q=1",
  });
  expect(preferredIdentity.headers.has("content-encoding")).toBe(false);
  expect(await preferredIdentity.text()).toBe(raw);

  const gzip = await download({ "accept-encoding": "br, gzip" });
  const bytes = new Uint8Array(await gzip.arrayBuffer());
  expect(gzip.status).toBe(200);
  expect(gzip.headers.get("content-encoding")).toBe("gzip");
  expect(gzip.headers.get("content-type")).toBe("application/json");
  expect(gzip.headers.get("cache-control")).toBe("no-store");
  expect(gunzipSync(bytes).toString()).toBe(raw);
  expect(bytes.length).toBeLessThan(Buffer.byteLength(raw));

  const curator = await download({ "accept-encoding": "gzip", cookie });
  expect(curator.status).toBe(200);
  expect(curator.headers.has("content-encoding")).toBe(false);
  expect(await curator.json()).toHaveProperty("submitterEmail");
});

it("authorizes the formal Project HTTP entry using a real regional handoff and reads/saves locally", async () => {
  const origin = "https://cn.test",
    secret = "regional-service-secret-for-isolated-http-tests";
  const config = JSON.stringify({
    origin: ORIGIN,
    clientOrigin: origin,
    secret,
  });
  const env = environment({ AUTH_REGIONAL_AUTHORITY: config }),
    cookie = await makerOf(env);
  const makeStore = (region: "cn" | "overseas") => {
    const store = new RegionalProjectDO(sqliteState(), {
      PROJECT_REGION: region,
    });
    return {
      getByName: () => ({
        fetch: (url: string, init?: RequestInit) =>
          store.fetch(new Request(url, init)),
      }),
    };
  };
  const source = {
    ...env,
    PROJECTS: makeStore("overseas"),
    PROJECT_SYNC_TOKEN: "source-secret",
  };
  const project = (
    await (
      await route(source, saveRequest(cookie, "Existing account Project"))
    ).json()
  ).project;
  const state = sqliteState();
  const localAuth = new RegionalSessionDO(
    { storage: { ...state.storage, setAlarm: async () => {} } },
    { AUTH_REGIONAL_CLIENT: config },
  );
  localAuth.fetchLike = (async (input, init) =>
    env.authDurable.fetch(new Request(input, init))) as typeof fetch;
  const target = {
    ...env,
    ...regionalRuntimeBindings(),
    AUTH: {
      getByName: () => ({
        fetch: (input: Request | string, init?: RequestInit) =>
          localAuth.fetch(
            typeof input === "string" ? new Request(input, init) : input,
          ),
      }),
    },
    AUTH_REGIONAL_CLIENT: config,
    PROJECTS: makeStore("cn"),
    PROJECT_SYNC_TOKEN: "target-secret",
    PROJECT_IDENTITY_URL: `${ORIGIN}/api/auth/regional/identities`,
    PROJECT_IDENTITY_TOKEN: secret,
    PROJECT_WRITES_ENABLED: "false",
  };
  const start = await entry.fetch(
    new Request(`${origin}/api/auth/regional/start`),
    target,
  );
  const authorized = await env.authDurable.fetch(
    new Request(start.headers.get("location")!, {
      headers: { Cookie: cookie },
    }),
  );
  const callback = await entry.fetch(
    new Request(authorized.headers.get("location")!, {
      headers: { Cookie: start.headers.get("set-cookie")!.split(";")[0]! },
    }),
    target,
  );
  expect(callback.status, await callback.clone().text()).toBe(302);
  const localCookie = callback.headers.get("set-cookie")!.split(";")[0]!;
  expect(localCookie).toMatch(/^icm_regional_session=/);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) =>
      env.authDurable.fetch(new Request(input, init)),
    ),
  );
  const { events } = await (
    await route(
      source,
      new Request(`${ORIGIN}/api/project-sync/events`, {
        headers: { Authorization: "Bearer source-secret" },
      }),
    )
  ).json();
  expect(
    (
      await entry.fetch(
        new Request(`${origin}/api/project-sync/events`, {
          method: "POST",
          headers: { Authorization: "Bearer target-secret" },
          body: JSON.stringify({ event: events[0] }),
        }),
        target,
      )
    ).status,
  ).toBe(200);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("cross-border unavailable");
    }),
  );
  const open = await entry.fetch(
    new Request(`${origin}/api/projects/${project.id}`, {
      headers: { Cookie: localCookie },
    }),
    target,
  );
  expect((await open.json()).project.id).toBe(project.id);
  const save = () =>
    new Request(`${origin}/api/projects/${project.id}`, {
      method: "PUT",
      headers: {
        Cookie: localCookie,
        Origin: origin,
        "If-Match": project.saveToken,
      },
      body: JSON.stringify({
        name: "Local change",
        projectText: projectText("Local change"),
      }),
    });
  expect((await entry.fetch(save(), target)).status).toBe(503);
  expect(
    (await entry.fetch(save(), { ...target, PROJECT_WRITES_ENABLED: "true" }))
      .status,
  ).toBe(200);
  expect(
    (
      await entry.fetch(
        new Request(`${origin}/api/projects/${project.id}`),
        target,
      )
    ).status,
  ).toBe(401);
  const unconfigured = await entry.fetch(
    new Request(`${origin}/api/simulation/run`),
    target,
  );
  expect(unconfigured.status).toBe(503);
  expect(await unconfigured.json()).toMatchObject({
    error: "simulation-operations-not-configured",
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("serves the Canvas page, Gallery, User Components and Agent discovery from one regional entrance", async () => {
  const origin = "http://localhost:18082";
  const source = environment();
  const target = {
    ...source,
    AUTH: source.AUTH!,
    ...regionalRuntimeBindings(),
    AUTH_REGIONAL_CLIENT: JSON.stringify({
      origin: ORIGIN,
      clientOrigin: origin,
      secret: "isolated-unified-runtime-service-secret",
    }),
    PROJECT_WRITES_ENABLED: "false",
  };
  const shell = await entry.fetch(new Request(`${origin}/editor`), target);
  expect(shell.status).toBe(200);
  expect(await shell.text()).toContain("Canvas trial");
  for (const path of [
    "/api/gallery",
    "/api/components",
    "/api/agent/mcp-manifest.json",
  ]) {
    const response = await entry.fetch(new Request(origin + path), target);
    expect(response.status, `${path}: ${await response.clone().text()}`).toBe(
      200,
    );
    expect(response.headers.get("content-type")).toContain("application/json");
  }
});
