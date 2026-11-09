import { expect, it } from "vitest";
import { liveAgentEditor } from "./live-agent-editor.test-support";

it("keeps an omitted cursor total nullable through the real Agent list client", async () => {
  const editor = liveAgentEditor({
    projectHost: {
      fetch: async (input) =>
        Response.json(
          String(input).includes("cursor=")
            ? { entries: [], nextCursor: null }
            : { entries: [], nextCursor: "page-2", total: 40 },
        ),
    },
  });
  await editor.client.connect("session-1.code");
  const list = (cursor?: string) =>
    editor.client.projectResource({
      apiVersion: "3.0",
      requestId: cursor ?? "first",
      operation: "list-gallery",
      ...(cursor ? { cursor } : {}),
    });
  await expect(list()).resolves.toMatchObject({ ok: true, total: 40 });
  await expect(list("page-2")).resolves.toMatchObject({
    ok: true,
    entries: [],
    nextCursor: null,
    total: null,
  });
});

it.each([
  [404, {}, "GALLERY_ENTRY_NOT_FOUND", "fix-input", "does not exist"],
  [
    429,
    { error: "too-many-requests", retryAfterSeconds: 12 },
    "GALLERY_UNAVAILABLE",
    "retry",
    "Wait 12 seconds",
  ],
  [503, {}, "GALLERY_UNAVAILABLE", "retry", "server could not answer"],
] as const)(
  "keeps read HTTP %s distinct",
  async (status, body, code, recovery, message) => {
    const editor = liveAgentEditor({
      projectHost: { fetch: async () => Response.json(body, { status }) },
    });
    await editor.client.connect("session-1.code");
    expect(
      await editor.client.projectResource({
        apiVersion: "3.0",
        requestId: "read",
        operation: "read-gallery-entry",
        galleryEntryId: "g1",
      }),
    ).toMatchObject({
      ok: false,
      error: { code, recovery, message: expect.stringContaining(message) },
    });
  },
);
