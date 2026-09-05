import { describe, expect, it } from "vitest";

import {
  channelResponse,
  markPreviewResponse,
  previewGalleryReadThrough,
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

  it("serves gallery reads from the public site, as an anonymous visitor", async () => {
    const env = {
      ICM_CHANNEL: "preview",
      ICM_GALLERY_UPSTREAM: "https://public.test",
    };
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchLike = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": "x=1" },
      });
    }) as unknown as typeof fetch;
    const request = new Request("https://preview.test/api/gallery?page=2", {
      headers: { cookie: "icm_session=secret", accept: "application/json" },
    });
    const response = await previewGalleryReadThrough(request, env, fetchLike);
    expect(response?.status).toBe(200);
    expect(await response!.json()).toEqual({ entries: [] });
    // Same path and query on the public origin; the visitor's cookie never
    // travels, and the upstream's own cookie never comes back.
    expect(seen[0]?.url).toBe("https://public.test/api/gallery?page=2");
    expect(new Headers(seen[0]?.init.headers).get("cookie")).toBeNull();
    expect(response?.headers.get("set-cookie")).toBeNull();
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("reads through only on the preview, only for gallery reads", async () => {
    const env = {
      ICM_CHANNEL: "preview",
      ICM_GALLERY_UPSTREAM: "https://public.test",
    };
    const never = (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch;
    expect(
      await previewGalleryReadThrough(req("/api/gallery"), {}, never),
    ).toBeNull();
    expect(
      await previewGalleryReadThrough(req("/api/projects/p1"), env, never),
    ).toBeNull();
    expect(
      await previewGalleryReadThrough(
        req("/api/gallery/x/like", "POST"),
        env,
        never,
      ),
    ).toBeNull();
    // A preview with no upstream says so instead of showing its empty store
    // as if it were the gallery.
    const unconfigured = await previewGalleryReadThrough(
      req("/api/gallery"),
      { ICM_CHANNEL: "preview" },
      never,
    );
    expect(unconfigured?.status).toBe(503);
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

  it("preserves the WebSocket upgrade response without rebuilding or mutating it", () => {
    // Node's Response rejects 101; model the workerd-only extension on a
    // real Response. The original implementation throws on reconstruction.
    const upgrade = new Response(null, {
      headers: { "sec-websocket-protocol": "icm-editor" },
    });
    const socket = {};
    Object.defineProperties(upgrade, {
      status: { value: 101 },
      webSocket: { value: socket },
    });
    const marked = markPreviewResponse(upgrade, { ICM_CHANNEL: "preview" });
    expect(marked).toBe(upgrade);
    expect(marked.status).toBe(101);
    expect((marked as Response & { webSocket: unknown }).webSocket).toBe(
      socket,
    );
    expect(marked.headers.get("sec-websocket-protocol")).toBe("icm-editor");
    expect(marked.headers.get("x-robots-tag")).toBeNull();
  });
});
