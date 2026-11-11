import { expect, vi } from "vitest";
import { accounts, transportOrigin } from "./regional-auth.test-support";
import {
  makerOf,
  ORIGIN,
  sqliteState,
  submissionRequest,
  wiredProjectText,
} from "./gallery.test-support";
import { GalleryDO, ComponentLibraryDO } from "./index";
import { routeComponentLibraryRequest } from "./component-library";
import { routeGalleryRequest } from "./gallery";
import { routeResourceSync } from "./resource-sync";
import { routeRegionalResourceActions } from "./regional-resource-actions";
import { routeProjectSync } from "./project-sync";
import { routeCloudProjects } from "./gallery-cloud-projects";
export async function pair(options: { projects?: boolean } = {}) {
  const auth = accounts();
  const cookie = await makerOf(auth.source);
  const cnCookie = await auth.connect(cookie);
  const { user } = await (
    await auth.source.authDurable.fetch(
      new Request(ORIGIN + "/api/auth/me", { headers: { cookie } }),
    )
  ).json();
  const make = (region: "cn" | "overseas") => {
    const state = sqliteState();
    const env = {
      ...(region === "cn" ? auth.resources : auth.source),
      ...(options.projects
        ? {
            PROJECT_REGION: region,
            PROJECT_REGION_USERS: JSON.stringify([user.id]),
            PROJECT_WRITES_ENABLED: "true",
            PROJECTS_STORE_NAME: "gallery" as const,
            PROJECT_SYNC_TOKEN:
              region === "cn" ? "cn-projects" : "source-projects",
            PROJECT_SYNC_PEER_TOKEN:
              region === "cn" ? "source-projects" : "cn-projects",
            PROJECT_SYNC_PEER_URL:
              region === "cn" ? transportOrigin : "https://china.test",
          }
        : {}),
      RESOURCE_REGION: region,
      RESOURCE_WRITES_ENABLED: "true",
      RESOURCE_ACTION_PEER:
        region === "cn" ? transportOrigin : "https://china.test",
      RESOURCE_SYNC_TOKEN: region === "cn" ? "cn-sync" : "source-sync",
      RESOURCE_SYNC_PEER_TOKEN: region === "cn" ? "source-sync" : "cn-sync",
      PROJECT_IDENTITY_URL: transportOrigin + "/api/auth/regional/identities",
      PROJECT_IDENTITY_TOKEN: "isolated-regional-account-service-secret",
    };
    let store = new GalleryDO(state, env);
    const datasets = new Map<
      string,
      {
        state: ReturnType<typeof sqliteState>;
        store: InstanceType<typeof GalleryDO>;
      }
    >();
    const componentState = sqliteState();
    let components = new ComponentLibraryDO(componentState, env);
    const componentBinding = {
      getByName: () => ({
        fetch: (input: string, init?: RequestInit) =>
          components.fetch(new Request(input, init)),
      }),
    };
    Object.assign(env, { COMPONENT_LIBRARY: componentBinding });
    env.GALLERY = {
      getByName: (name: string) => ({
        fetch: (input: string, init?: RequestInit) =>
          (() => {
            if (name === "gallery")
              return store.fetch(new Request(input, init));
            let dataset = datasets.get(name);
            if (!dataset) {
              const state = sqliteState();
              dataset = { state, store: new GalleryDO(state, env) };
              datasets.set(name, dataset);
            }
            return dataset.store.fetch(new Request(input, init));
          })(),
      }),
    };
    if (options.projects) Object.assign(env, { PROJECTS: env.GALLERY });
    const route = async (request: Request): Promise<Response> =>
      (await routeRegionalResourceActions(request, env)) ??
      (await routeResourceSync(request, env)) ??
      (await routeProjectSync(request, env)) ??
      (await routeCloudProjects(request, env, new URL(request.url))) ??
      (await routeGalleryRequest(request, env)) ??
      (await routeComponentLibraryRequest(request, {
        ...env,
        COMPONENT_LIBRARY: componentBinding,
      }))!;
    const call = (path: string, method = "GET", key?: string, body?: unknown) =>
      route(
        new Request(ORIGIN + path, {
          method,
          headers: {
            origin: ORIGIN,
            cookie: region === "cn" ? cnCookie : cookie,
            ...(key ? { "idempotency-key": key } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    return {
      env,
      get store() {
        return store;
      },
      get components() {
        return components;
      },
      legacyComponentDefinition: (id: string, definition: unknown) => {
        componentState.storage.sql.exec(
          "UPDATE components SET definition=? WHERE id=?",
          JSON.stringify(definition),
          id,
        );
      },
      route,
      call,
      restart: () => {
        store = new GalleryDO(state, env);
        for (const dataset of datasets.values())
          dataset.store = new GalleryDO(dataset.state, env);
        components = new ComponentLibraryDO(componentState, env);
      },
    };
  };
  const overseas = make("overseas"),
    cn = make("cn");
  let loseReply = false;
  let loseCatchup = false;
  let beforeCatchup: (() => Promise<void>) | undefined;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init),
        url = new URL(request.url);
      if (url.pathname.startsWith("/api/auth/"))
        return auth.source.authDurable.fetch(request);
      if (loseCatchup && url.pathname.endsWith("/changes")) {
        loseCatchup = false;
        throw new TypeError("Catch-up connection lost");
      }
      if (beforeCatchup && url.pathname.endsWith("/changes")) {
        const run = beforeCatchup;
        beforeCatchup = undefined;
        await run();
      }
      const response = await (
        url.origin === transportOrigin ? overseas : cn
      ).route(request);
      if (
        loseReply &&
        url.pathname.startsWith("/api/resource-actions/") &&
        response.ok
      ) {
        loseReply = false;
        throw new TypeError("Connection lost after commit");
      }
      return response;
    },
  );
  const publish = async (site: typeof cn, publishingCookie?: string) => {
    const response = await site.route(
      submissionRequest(
        {
          name: "Regional lifecycle",
          projectText: wiredProjectText(),
          tags: [],
        },
        { cookie: publishingCookie ?? (site === cn ? cnCookie : cookie) },
      ),
    );
    expect(response.status).toBe(201);
    const { id } = await response.json();
    const peer = site === cn ? overseas : cn;
    const status = await peer.store.fetch(
      new Request("https://store/resource-sync/status", {
        method: "POST",
        body: JSON.stringify({ stream: "gallery" }),
      }),
    );
    const after = (await status.json()).received?.sequence ?? 0;
    const change = await site.store.fetch(
      new Request("https://store/resource-sync/changes", {
        method: "POST",
        body: JSON.stringify({ stream: "gallery", after }),
      }),
    );
    const imported = await peer.store.fetch(
      new Request("https://store/resource-sync/receive", {
        method: "POST",
        body: JSON.stringify({
          stream: "gallery",
          envelope: await change.json(),
        }),
      }),
    );
    expect(imported.status).toBe(200);
    return id as string;
  };
  return {
    cn,
    overseas,
    publish,
    auth,
    cookie,
    cnCookie,
    loseNextReply: () => {
      loseReply = true;
    },
    loseNextCatchup: () => {
      loseCatchup = true;
    },
    beforeNextCatchup: (run: () => Promise<void>) => {
      beforeCatchup = run;
    },
  };
}
