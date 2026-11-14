import { parseProject } from "@icm/project-protocol";
import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  canUpdateGalleryPublication,
  galleryFixOf,
  describePublishOutcome,
  loadGalleryPublicationContext,
  loadGalleryQuota,
  publishProjectToGallery,
} from "./gallery-publish";

const project = createEmptyProject("p1", "Ring Oscillator");

function fetchReturning(
  status: number,
  payload: unknown,
  seen: { url?: string; init?: RequestInit | undefined } = {},
): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith("/intent"))
      return Response.json({ key: crypto.randomUUID() });
    seen.url = String(url);
    seen.init = init;
    return new Response(JSON.stringify(payload), { status });
  }) as typeof fetch;
}

describe("canUpdateGalleryPublication", () => {
  const context = (id: string, ownerUserId: string | null) => ({
    id,
    name: "OTA",
    projectId: "p1",
    ownerUserId,
    author: "Someone",
    description: "",
    tags: [],
  });
  const admin = { id: "a1", isAdmin: true };

  it("offers the update to the owner and the Owner; others' drawings to whoever may fix them", () => {
    expect(
      canUpdateGalleryPublication(context("k7m2", "u1"), {
        id: "u1",
        isAdmin: false,
      }),
    ).toBe(true);
    const other = { id: "u2", isAdmin: false };
    expect(canUpdateGalleryPublication(context("k7m2", "u1"), other)).toBe(
      false,
    );
    // Someone else's circuit is fixed in place, by the byline it keeps.
    expect(
      canUpdateGalleryPublication(context("k7m2", "u1"), other, {
        allowed: true,
      }),
    ).toBe(true);
    expect(galleryFixOf(context("k7m2", "u1"), other)).toBe("Someone");
    expect(
      galleryFixOf(context("k7m2", "u1"), { id: "u1", isAdmin: false }),
    ).toBeNull();
    expect(galleryFixOf(context("k7m2", "u1"), admin)).toBeNull();
    expect(canUpdateGalleryPublication(context("k7m2", "u1"), admin)).toBe(
      true,
    );
    // A dataset's drawing follows the quota's permission alone.
    const reader = { id: "u3", isAdmin: false };
    expect(canUpdateGalleryPublication(context("ag-308", null), admin)).toBe(
      false,
    );
    expect(
      canUpdateGalleryPublication(context("ag-308", null), reader, {
        allowed: false,
      }),
    ).toBe(false);
    expect(
      canUpdateGalleryPublication(context("ag-308", null), reader, {
        allowed: true,
      }),
    ).toBe(true);
  });
});

describe("loadGalleryQuota", () => {
  it("reads today's allowance, and nothing when signed out", async () => {
    const quota = {
      limit: 100,
      used: 3,
      remaining: 97,
      resetsAt: "2026-10-08T00:00:00.000Z",
      exempt: false,
      fixes: { allowed: true, contributions: 12, needed: 10 },
    };
    expect(await loadGalleryQuota(fetchReturning(200, quota))).toEqual(quota);
    expect(
      await loadGalleryQuota(fetchReturning(401, { error: "unauthorized" })),
    ).toBeNull();
  });
});

describe("loadGalleryPublicationContext", () => {
  it("brings the entry's AI mark into the update dialog", async () => {
    const load = (entry: object) =>
      loadGalleryPublicationContext(
        "entry-1",
        "p1",
        fetchReturning(200, {
          entry: { name: "Ring", author: "A", ...entry },
          ownerUserId: "u1",
        }),
      );
    expect((await load({ aiGenerated: true }))?.aiGenerated).toBe(true);
    expect((await load({}))?.aiGenerated).toBe(false);
  });
});

describe("publishProjectToGallery", () => {
  it("retains the publication intent when a success response body is truncated", async () => {
    const keys: string[] = [];
    let prepared = 0;
    const network = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/intent")) {
        prepared++;
        return Response.json({ key: `cn_intent-${prepared}` });
      }
      keys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
      return keys.length === 1
        ? new Response('{"id":', { status: 201 })
        : Response.json(
            { id: "one-publication", previewRevision: "r1" },
            { status: 201 },
          );
    }) as typeof fetch;
    const fields = { name: "Truncated reply", description: "", tags: [] };
    const first = await publishProjectToGallery(project, fields, network);
    expect(first.status).toBe("unreachable");
    const retry = await publishProjectToGallery(project, fields, network);
    expect(retry).toMatchObject({ status: "published", id: "one-publication" });
    expect(keys).toEqual(["cn_intent-1", "cn_intent-1"]);
    const deliberate = await publishProjectToGallery(project, fields, network);
    expect(deliberate.status).toBe("published");
    expect(keys).toEqual(["cn_intent-1", "cn_intent-1", "cn_intent-2"]);
  });
  it("keeps archived source text private without dropping the routing reference", async () => {
    const imported = structuredClone(project);
    imported.source.files = [
      {
        id: "source",
        path: "private.spi",
        hash: "source-hash",
        content: { text: "private comment", encoding: "utf-8" },
        originalContent: { text: "private original", encoding: "utf-8" },
      },
    ];
    imported.documents[0]!.importReference = {
      files: [{ fileId: "source" }],
      nets: [],
    };
    const seen: { url?: string; init?: RequestInit } = {};
    await publishProjectToGallery(
      imported,
      { name: "test", description: "", tags: [], aiGenerated: false },
      fetchReturning(201, { id: "entry", previewRevision: "0" }, seen),
    );
    const published = parseProject(
      JSON.parse(String(seen.init?.body)).projectText,
    );
    expect(published.source.files[0]?.content).toBeUndefined();
    expect(published.source.files[0]?.originalContent).toBeUndefined();
    expect(published.documents[0]?.importReference).toEqual(
      imported.documents[0]?.importReference,
    );
    expect(imported.source.files[0]?.content?.text).toBe("private comment");
  });
  it("posts the serialized Project under the session cookie alone", async () => {
    const seen: { url?: string; init?: RequestInit | undefined } = {};
    const outcome = await publishProjectToGallery(
      project,
      {
        name: "  Ring Oscillator  ",
        description: "Five stages",
        tags: ["Amplifier", "OTA"],
        aiGenerated: true,
      },
      fetchReturning(
        201,
        { id: "entry-1", previewRevision: "revision-0" },
        seen,
      ),
    );
    expect(outcome).toEqual({
      status: "published",
      id: "entry-1",
      previewRevision: "revision-0",
    });
    expect(seen.url).toBe("/api/gallery/submissions/commit");
    expect(seen.init?.credentials).toBe("same-origin");

    // No passphrase travels any more: the cookie is the whole credential.
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();

    const body = JSON.parse(String(seen.init?.body)) as {
      name: string;
      description: string;
      aiGenerated: boolean;
      projectText: string;
    };
    expect(body.name).toBe("Ring Oscillator");
    expect(body.description).toBe("Five stages");
    expect(body.aiGenerated).toBe(true);
    // The byline is the server's to set from the session, so the request
    // carries no author claim at all.
    expect(body).not.toHaveProperty("author");
    expect(parseProject(body.projectText).schemaVersion).toBe(
      project.schemaVersion,
    );
  });

  it("maps every documented rejection to a typed outcome", async () => {
    const cases: [number, unknown, string][] = [
      [401, { error: "unauthorized" }, "unauthorized"],
      [413, { error: "too-large" }, "too-large"],
      [429, { error: "rate-limited" }, "rate-limited"],
      [400, { error: "invalid-fields" }, "rejected"],
    ];
    for (const [status, payload, expected] of cases) {
      const outcome = await publishProjectToGallery(
        project,
        { name: "N", description: "", tags: [], aiGenerated: false },
        fetchReturning(status, payload),
      );
      expect(outcome.status).toBe(expected);
      expect(describePublishOutcome(outcome)).not.toHaveLength(0);
    }
  });

  it("reads a 422 as the quality gates, not as a refusal", async () => {
    const outcome = await publishProjectToGallery(
      project,
      { name: "N", description: "", tags: [], aiGenerated: false },
      fetchReturning(422, {
        error: "quality-gate",
        failures: [
          { code: "empty-project", message: "Nothing to publish", count: 1 },
        ],
      }),
    );
    expect(outcome).toMatchObject({
      status: "gate-failed",
      failures: [{ code: "empty-project" }],
    });
  });

  it("reports a thrown fetch as unreachable", async () => {
    const outcome = await publishProjectToGallery(
      project,
      { name: "N", description: "", tags: [], aiGenerated: false },
      (() => Promise.reject(new Error("offline"))) as typeof fetch,
    );
    expect(outcome).toEqual({ status: "unreachable", message: "offline" });
  });

  it("points a signed-out publisher at signing in, not at a passphrase", () => {
    expect(describePublishOutcome({ status: "unauthorized" })).toContain(
      "sign in",
    );
  });
});
