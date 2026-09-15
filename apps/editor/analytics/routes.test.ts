import { describe, expect, it } from "vitest";

import {
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
