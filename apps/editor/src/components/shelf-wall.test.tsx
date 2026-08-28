import { describe, expect, it } from "vitest";

import { cloudProjectPreviewUrl } from "../features/editor-shell/cloud-projects";
import { loadShelf, shelfProjectHref } from "./shelf-wall";

function fetchReturning(payload: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

describe("loadShelf", () => {
  it("lists the signed-in member's own Projects", async () => {
    const state = await loadShelf(
      fetchReturning({
        projects: [
          {
            id: "p1",
            name: "Bandgap",
            updatedAt: "2026-08-28T10:00:00.000Z",
            revision: 4,
            schemaVersion: 26,
          },
        ],
      }),
    );
    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;
    expect(state.projects.map((project) => project.name)).toEqual(["Bandgap"]);
  });

  it("reads a signed-out visitor as signed-out rather than empty", async () => {
    // An empty shelf and no shelf are different things: one invites a first
    // save, the other invites signing in.
    const state = await loadShelf(
      fetchReturning({ error: "unauthorized" }, 401),
    );
    expect(state.status).toBe("signed-out");
  });

  it("keeps a reachable-but-broken worker distinct from being signed out", async () => {
    const state = await loadShelf(fetchReturning({ error: "boom" }, 502));
    expect(state.status).toBe("unreachable");
  });
});

describe("shelf tile addressing", () => {
  it("opens a Project by id in the editor", () => {
    expect(shelfProjectHref("p1")).toBe("/editor?project=p1");
  });

  it("escapes an id rather than pasting it into the query", () => {
    expect(shelfProjectHref("a b&c")).toBe("/editor?project=a%20b%26c");
  });

  it("names the thumbnail by revision so a saved change is seen at once", () => {
    expect(cloudProjectPreviewUrl("p1", 4)).toBe(
      "/api/projects/p1/preview.svg?v=4",
    );
    expect(cloudProjectPreviewUrl("p1", 5)).not.toBe(
      cloudProjectPreviewUrl("p1", 4),
    );
  });
});
