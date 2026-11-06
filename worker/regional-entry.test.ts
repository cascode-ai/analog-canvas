import { afterEach, expect, it, vi } from "vitest";
import entry from "./regional-entry";
import { RegionalProjectDO } from "./regional-projects";
import { RegionalSessionDO } from "./regional-session";
import {
  environment,
  makerOf,
  route,
  saveRequest,
  sqliteState,
  ORIGIN,
  projectText,
} from "./gallery.test-support";

afterEach(() => vi.unstubAllGlobals());
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
  expect(localCookie).toMatch(/^icm_session=/);
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
  expect(
    (await entry.fetch(new Request(`${origin}/api/simulation/run`), target))
      .status,
  ).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
