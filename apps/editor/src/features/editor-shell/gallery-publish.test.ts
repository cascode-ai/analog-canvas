import { parseProject } from "@icm/project-protocol";
import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  describePublishOutcome,
  publishProjectToGallery,
} from "./gallery-publish";

const project = createEmptyProject("p1", "Ring Oscillator");

function fetchReturning(
  status: number,
  payload: unknown,
  seen: { url?: string; init?: RequestInit | undefined } = {},
): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init;
    return new Response(JSON.stringify(payload), { status });
  }) as typeof fetch;
}

describe("publishProjectToGallery", () => {
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
      { name: "test", description: "", tags: [] },
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
    expect(seen.url).toBe("/api/gallery/submissions");
    expect(seen.init?.credentials).toBe("same-origin");

    // No passphrase travels any more: the cookie is the whole credential.
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();

    const body = JSON.parse(String(seen.init?.body)) as {
      name: string;
      description: string;
      projectText: string;
    };
    expect(body.name).toBe("Ring Oscillator");
    expect(body.description).toBe("Five stages");
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
        { name: "N", description: "", tags: [] },
        fetchReturning(status, payload),
      );
      expect(outcome.status).toBe(expected);
      expect(describePublishOutcome(outcome)).not.toHaveLength(0);
    }
  });

  it("reads a 422 as the quality gates, not as a refusal", async () => {
    const outcome = await publishProjectToGallery(
      project,
      { name: "N", description: "", tags: [] },
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
      { name: "N", description: "", tags: [] },
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
