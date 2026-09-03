import { describe, expect, it } from "vitest";

import { loadReleaseChannel } from "./release-channel";

const answering = (status: number, body: unknown): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

describe("release channel discovery", () => {
  it("reads a preview answer", async () => {
    expect(
      await loadReleaseChannel(answering(200, { channel: "preview" })),
    ).toBe("preview");
  });

  it("is production for every other answer", async () => {
    // The public site must never be dressed up as a preview: an old Worker
    // without the endpoint, a failed request, or no network all read as
    // production.
    expect(
      await loadReleaseChannel(answering(200, { channel: "production" })),
    ).toBe("production");
    expect(await loadReleaseChannel(answering(404, { error: "x" }))).toBe(
      "production",
    );
    expect(
      await loadReleaseChannel((async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch),
    ).toBe("production");
    expect(await loadReleaseChannel(null)).toBe("production");
  });
});
