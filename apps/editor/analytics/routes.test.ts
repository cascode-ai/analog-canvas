import { describe, expect, it } from "vitest";

import { ANALYTICS_OPT_OUT_PATH } from "./client";
import {
  OPT_OUT_ROUTE,
  normalizeAcquisitionSource,
  normalizeTrackedPath,
  routeAnalyticsRequest,
  type AnalyticsRouteEnv,
} from "./routes";

function analyticsEnv(
  response: unknown,
  onFetch?: (input: string, init?: RequestInit) => void,
): AnalyticsRouteEnv {
  return {
    ANALYTICS_KEY: undefined,
    ANALYTICS: {
      getByName(name) {
        expect(name).toBe("global");
        return {
          async fetch(input, init) {
            onFetch?.(input, init);
            return Response.json(response);
          },
        };
      },
    },
  };
}

describe("analytics request normalization", () => {
  it("keeps bounded page paths and excludes analytics/API routes", () => {
    expect(normalizeTrackedPath("/editor?utm_source=github#canvas")).toBe(
      "/editor",
    );
    expect(normalizeTrackedPath("/analytics")).toBeNull();
    expect(normalizeTrackedPath("/api/stats")).toBeNull();
    expect(normalizeTrackedPath("https://example.com/")).toBeNull();
  });

  it("retains only normalized acquisition categories or hostnames", () => {
    const site = new URL("https://analog-canvas.tokenzhang.com/");
    expect(
      normalizeAcquisitionSource(
        "https://www.google.com/search?q=private",
        "",
        site,
      ),
    ).toBe("search:google");
    expect(
      normalizeAcquisitionSource(
        "https://github.com/some/private/path",
        "",
        site,
      ),
    ).toBe("social:github");
    expect(
      normalizeAcquisitionSource(
        "https://example.com/private/path?q=secret",
        "",
        site,
      ),
    ).toBe("ref:example.com");
    expect(normalizeAcquisitionSource("", "qrcode", site)).toBe("campaign:qr");
  });
});

describe("analytics HTTP routes", () => {
  it("delegates the public counters to the established global object", async () => {
    const response = await routeAnalyticsRequest(
      new Request("https://analog-canvas.tokenzhang.com/api/stats"),
      analyticsEnv({ pv: 47_111, uv: 11_781 }, (input) => {
        expect(input).toBe("https://analytics.internal/stats");
      }),
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      pv: 47_111,
      uv: 11_781,
      scope: "all",
    });
  });

  it("leaves unrelated requests for the host Worker", async () => {
    await expect(
      routeAnalyticsRequest(
        new Request("https://analog-canvas.tokenzhang.com/api/projects"),
        analyticsEnv({}),
      ),
    ).resolves.toBeNull();
  });
});

const SITE = "https://analog-canvas.tokenzhang.com";

function track(headers: Record<string, string> = {}) {
  return new Request(`${SITE}/api/track`, {
    method: "POST",
    headers: {
      origin: SITE,
      "user-agent": "Mozilla/5.0 Firefox/150.0",
      ...headers,
    },
    body: JSON.stringify({ p: "/editor", r: "", s: "" }),
  });
}

describe("the visitor cookie", () => {
  it("is set once, never renewed, and the retired source cookie goes", async () => {
    let counted = 0;
    const env = analyticsEnv({ pv: 1, uv: 1, scope: "all" }, () => {
      counted += 1;
    });
    const first = await routeAnalyticsRequest(track(), env);
    const [visitor] = first!.headers.getSetCookie();
    expect(visitor).toMatch(
      /^canvas_vid=[0-9a-f-]{36}; Path=\/; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure$/u,
    );
    const id = visitor!.split(";")[0]!;
    const returning = await routeAnalyticsRequest(
      track({ cookie: `${id}; canvas_sid=social:github` }),
      env,
    );
    expect(returning!.headers.getSetCookie()).toEqual([
      "canvas_sid=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly; Secure",
    ]);
    expect(counted).toBe(2);
  });

  it("is never set for a browser that asks not to be counted", async () => {
    let counted = 0;
    const env = analyticsEnv({}, () => {
      counted += 1;
    });
    for (const headers of [
      { DNT: "1" },
      { "Sec-GPC": "1" },
      { cookie: "canvas_optout=1" },
    ]) {
      const response = await routeAnalyticsRequest(track(headers), env);
      expect(response!.status).toBe(204);
      expect(response!.headers.getSetCookie()).toEqual([]);
    }
    expect(counted).toBe(0);
  });

  it("answers at the path the privacy notice calls", () => {
    expect(OPT_OUT_ROUTE).toBe(ANALYTICS_OPT_OUT_PATH);
  });

  it("opts out, and back in, from the privacy notice", async () => {
    const env = analyticsEnv({});
    const optOut = (optOut: unknown, origin = SITE) =>
      routeAnalyticsRequest(
        new Request(`${SITE}/api/track/opt-out`, {
          method: "POST",
          headers: { origin, cookie: "canvas_vid=x" },
          body: JSON.stringify({ optOut }),
        }),
        env,
      );
    const out = await optOut(true);
    expect(await out!.json()).toEqual({ optedOut: true });
    expect(out!.headers.getSetCookie()).toEqual([
      "canvas_optout=1; Path=/; Max-Age=34214400; SameSite=Lax; HttpOnly; Secure",
      "canvas_vid=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly; Secure",
    ]);
    const back = await optOut(false);
    expect(back!.headers.getSetCookie()).toEqual([
      "canvas_optout=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly; Secure",
    ]);
    expect((await optOut(true, "https://elsewhere.example"))!.status).toBe(403);
    expect((await optOut("yes"))!.status).toBe(400);
    const state = await routeAnalyticsRequest(
      new Request(`${SITE}/api/track/opt-out`, {
        headers: { cookie: "canvas_optout=1" },
      }),
      env,
    );
    expect(await state!.json()).toEqual({ optedOut: true });
  });
});
