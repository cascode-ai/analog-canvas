import { describe, expect, it } from "vitest";

import { normalizeAcquisitionSource, normalizeTrackedPath } from "./index";

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
