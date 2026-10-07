import { describe, expect, it } from "vitest";

import type { GalleryPublicationRecord } from "../features/editor-shell/gallery-publish";
import { createAgentGalleryPublisher } from "./agent-gallery-publish";
import {
  emptyAgentProject,
  liveAgentEditor,
} from "./live-agent-editor.test-support";

/** The Gallery's answers over the network; it keeps what it was sent. */
function galleryServer(status = 201) {
  const sent: { method: string; url: string; body: Record<string, unknown> }[] =
    [];
  const answer = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "GET")
      return url === "/api/gallery/entry-7?summary=1"
        ? Response.json({
            entry: {
              name: "Stored name",
              author: "Opus 5.5",
              description: "Stored description",
              tags: ["amplifier"],
              aiGenerated: true,
            },
            ownerUserId: "u1",
          })
        : new Response(null, { status: 404 });
    sent.push({ method, url, body: JSON.parse(String(init?.body)) });
    return Response.json(
      {
        id: method === "POST" ? "entry-new" : "entry-7",
        previewRevision: "r1",
      },
      { status: method === "POST" ? status : status === 201 ? 200 : status },
    );
  }) as typeof fetch;
  return { sent, fetch: answer };
}

function editorWith(server: ReturnType<typeof galleryServer>, shown = true) {
  const recorded: GalleryPublicationRecord[] = [];
  const editor = liveAgentEditor({
    project: emptyAgentProject("Folded cascode"),
    projectHost: {
      publishToGallery: createAgentGalleryPublisher({
        current: () =>
          shown
            ? {
                project: editor.controller.project,
                linked: null,
                cloudBinding: null,
              }
            : null,
        published: (outcome) => recorded.push(outcome),
        fetch: server.fetch,
      }),
    },
  });
  return { ...editor, recorded };
}

const envelope = { apiVersion: "3.0" as const, requestId: "publish-1" };

describe("an Agent publishes to the Gallery (#1415)", () => {
  it("publishes the shown working copy as a new entry, marked AI", async () => {
    const server = galleryServer();
    const { client, recorded } = editorWith(server);
    await client.connect("session-1.code");

    const result = await client.projectResource({
      ...envelope,
      operation: "publish-gallery-entry",
      description: "Two stages",
      tags: ["amplifier"],
    });

    expect(result).toMatchObject({
      ok: true,
      galleryEntryId: "entry-new",
      url: "/g/entry-new",
      previewRevision: "r1",
    });
    expect(server.sent).toEqual([
      {
        method: "POST",
        url: "/api/gallery/submissions",
        body: expect.objectContaining({
          name: "Folded cascode",
          description: "Two stages",
          tags: ["amplifier"],
          aiGenerated: true,
        }),
      },
    ]);
    expect(recorded).toEqual([
      expect.objectContaining({
        id: "entry-new",
        aiGenerated: true,
        updated: false,
      }),
    ]);
  });

  it("updates an entry keeping the fields it does not name, marked AI", async () => {
    const server = galleryServer();
    const { client, recorded } = editorWith(server);
    await client.connect("session-1.code");

    expect(
      await client.projectResource({
        ...envelope,
        operation: "update-gallery-entry",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "NO_LINKED_GALLERY_ENTRY", recovery: "fix-input" },
    });
    expect(
      await client.projectResource({
        ...envelope,
        requestId: "update-1",
        operation: "update-gallery-entry",
        galleryEntryId: "entry-7",
        name: "Renamed",
      }),
    ).toMatchObject({ ok: true, galleryEntryId: "entry-7" });

    const [put] = server.sent;
    expect(put).toMatchObject({ method: "PUT", url: "/api/gallery/entry-7" });
    expect(put!.body).toMatchObject({
      name: "Renamed",
      description: "Stored description",
      tags: ["amplifier"],
      aiGenerated: true,
    });
    expect(recorded).toEqual([
      expect.objectContaining({
        aiGenerated: true,
        updated: true,
        ownerUserId: "u1",
        author: "Opus 5.5",
      }),
    ]);
  });

  it("says what to do when signed out or when the tab is not shown", async () => {
    const signedOut = editorWith(galleryServer(401));
    await signedOut.client.connect("session-1.code");
    expect(
      await signedOut.client.projectResource({
        ...envelope,
        operation: "publish-gallery-entry",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIGN_IN_REQUIRED", recovery: "sign-in" },
    });
    // An update reads the entry first, and says the same when signed out.
    const reader = editorWith({
      sent: [],
      fetch: (async () =>
        Response.json(
          { error: "unauthorized" },
          { status: 401 },
        )) as typeof fetch,
    });
    await reader.client.connect("session-1.code");
    expect(
      await reader.client.projectResource({
        ...envelope,
        operation: "update-gallery-entry",
        galleryEntryId: "entry-7",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIGN_IN_REQUIRED", recovery: "sign-in" },
    });
    expect(signedOut.recorded).toEqual([]);

    const hidden = editorWith(galleryServer(), false);
    await hidden.client.connect("session-1.code");
    expect(
      await hidden.client.projectResource({
        ...envelope,
        operation: "publish-gallery-entry",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_NOT_SHOWN", recovery: "fix-input" },
    });
  });
});
