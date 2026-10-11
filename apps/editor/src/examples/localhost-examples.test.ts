import { describe, expect, it } from "vitest";

import { localhostExamplesEnabled } from "../gallery-client";

describe("bundled example host boundary", () => {
  it("uses Gallery only for an explicitly enabled local replica", () => {
    expect(localhostExamplesEnabled("localhost", true)).toBe(false);
    expect(localhostExamplesEnabled("localhost", false)).toBe(true);
  });
  it.each(["localhost", "127.0.0.1", "[::1]"])("allows %s", (hostname) => {
    expect(localhostExamplesEnabled(hostname)).toBe(true);
  });

  it.each(["analog-canvas.tokenzhang.com", "example.localhost", ""])(
    "does not offer bundled examples on %s",
    (hostname) => {
      expect(localhostExamplesEnabled(hostname)).toBe(false);
    },
  );
});
