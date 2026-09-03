import { describe, expect, it } from "vitest";

import {
  channelResponse,
  markPreviewResponse,
  previewRobotsResponse,
  previewWriteRefusal,
  releaseChannel,
} from "./channel";

const req = (path: string, method = "GET") =>
  new Request(`https://preview.test${path}`, { method });

describe("release channel", () => {
  it("is production unless the deployment says preview", () => {
    // Production never sets the variable. Anything but the exact word is
    // production too: a typo must not switch the public site into preview.
    expect(releaseChannel({})).toBe("production");
    expect(releaseChannel({ ICM_CHANNEL: "staging" })).toBe("production");
    expect(releaseChannel({ ICM_CHANNEL: "preview" })).toBe("preview");
  });

  it("tells the editor which channel it is on", async () => {
    const body = (await channelResponse({ ICM_CHANNEL: "preview" }).json()) as {
      channel: string;
    };
    expect(body.channel).toBe("preview");
    expect(
      ((await channelResponse({}).json()) as { channel: string }).channel,
    ).toBe("production");
  });

  it("refuses every write to the shared gallery and projects on the preview", async () => {
    const env = { ICM_CHANNEL: "preview" };
    for (const [path, method] of [
      ["/api/gallery/submissions", "POST"],
      ["/api/gallery/abc/like", "POST"],
      ["/api/gallery/abc", "DELETE"],
      ["/api/projects", "POST"],
      ["/api/projects/p1", "PUT"],
    ] as const) {
      const refusal = previewWriteRefusal(req(path, method), env);
      expect(refusal?.status, `${method} ${path}`).toBe(403);
      const body = (await refusal!.json()) as { error: string };
      expect(body.error).toBe("preview-read-only");
    }
  });

  it("lets the preview read, and leaves other routes alone", () => {
    const env = { ICM_CHANNEL: "preview" };
    expect(previewWriteRefusal(req("/api/gallery"), env)).toBeNull();
    expect(previewWriteRefusal(req("/api/projects/p1"), env)).toBeNull();
    // Simulation runs are the preview's whole purpose; agent sessions and
    // analytics are its own namespaces. None of these reach shared data.
    expect(previewWriteRefusal(req("/api/simulate", "POST"), env)).toBeNull();
    expect(previewWriteRefusal(req("/api/track", "POST"), env)).toBeNull();
    expect(
      previewWriteRefusal(req("/api/agent/sessions", "POST"), env),
    ).toBeNull();
  });

  it("never refuses anything on production", () => {
    expect(
      previewWriteRefusal(req("/api/gallery/submissions", "POST"), {}),
    ).toBeNull();
  });

  it("keeps the preview out of search engines", async () => {
    expect(await previewRobotsResponse().text()).toContain("Disallow: /");
    const marked = markPreviewResponse(new Response("shell"), {
      ICM_CHANNEL: "preview",
    });
    expect(marked.headers.get("x-robots-tag")).toContain("noindex");
    // Production responses pass through untouched.
    const untouched = markPreviewResponse(new Response("shell"), {});
    expect(untouched.headers.get("x-robots-tag")).toBeNull();
  });
});
