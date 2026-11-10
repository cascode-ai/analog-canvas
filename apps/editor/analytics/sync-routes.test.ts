import { afterEach, describe, expect, it, vi } from "vitest";
import { sqliteState } from "../../../worker/gallery.test-support";
import { AnalyticsDO } from "./worker";
import { routeAnalyticsRequest, type AnalyticsRouteEnv } from "./routes";

afterEach(() => vi.unstubAllGlobals());

function environment(store: AnalyticsDO, region: string) {
  return {
    ANALYTICS: {
      getByName: () => ({
        fetch: (input: string, init?: RequestInit) =>
          store.fetch(new Request(input, init)),
      }),
    },
    ANALYTICS_KEY: undefined,
    PROJECT_REGION: region,
    PROJECT_SYNC_TOKEN: region + "-peer",
    PROJECT_SYNC_ADMIN_TOKEN: region + "-admin",
    PROJECT_SYNC_PEER_TOKEN: "overseas-peer",
    PROJECT_SYNC_PEER_URL: "https://authority.example",
  };
}

async function call(
  env: AnalyticsRouteEnv,
  operation: string,
  token: string,
  body?: unknown,
) {
  return routeAnalyticsRequest(
    new Request("https://canvas.example/api/analytics-sync/" + operation, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: "Bearer " + token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );
}

describe("regional analytics HTTP transport", () => {
  it("authenticates management and catches up after an acknowledgement is lost without blocking local collection", async () => {
    const sourceStore = new AnalyticsDO(sqliteState());
    const localStore = new AnalyticsDO(sqliteState());
    const source = environment(sourceStore, "overseas"),
      local = environment(localStore, "cn");
    expect((await call(local, "activate", "cn-peer", {}))?.status).toBe(401);
    expect((await call(source, "prepare", "overseas-peer", {}))?.status).toBe(
      200,
    );
    const summary = await (await call(
      source,
      "summary",
      "overseas-peer",
    ))!.json();
    expect(
      (await call(local, "activate", "cn-admin", { summary }))?.status,
    ).toBe(200);
    let dropReceipt = false;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(request.headers.get("cookie")).toBeNull();
        const result = await routeAnalyticsRequest(request, source);
        if (dropReceipt && request.url.endsWith("/receive")) {
          dropReceipt = false;
          throw new TypeError("connection lost");
        }
        return result!;
      },
    );
    expect((await call(local, "tick", "cn-admin", {}))?.status).toBe(200);
    await localStore.fetch(
      new Request("https://analytics.internal/hit", {
        method: "POST",
        body: JSON.stringify({
          visitorHash: "a".repeat(64),
          path: "/editor",
          country: "XX",
          lat: null,
          lng: null,
          source: "direct-or-unknown",
        }),
      }),
    );
    dropReceipt = true;
    expect((await call(local, "tick", "cn-admin", {}))?.status).toBe(503);
    expect(
      (await (await call(local, "status", "cn-peer"))!.json()).pending,
    ).toBe(1);
    expect((await call(local, "tick", "cn-admin", {}))?.status).toBe(200);
    const cached = await localStore.fetch(
      new Request("https://analytics.internal/stats"),
    );
    expect(await cached.json()).toEqual({ pv: 1, uv: 1, scope: "all" });
    expect(
      (await (await call(local, "status", "cn-peer"))!.json()).pending,
    ).toBe(0);
  });
});
