import { expect, it } from "vitest";
import { liveAgentEditor } from "./live-agent-editor.test-support";

it.each([
  { operation: "list-gallery", scope: "ai-seats" },
  { operation: "read-gallery-entry", galleryEntryId: "g1" },
  { operation: "read-gallery-entry", galleryEntryId: "g1", render: "svg" },
  { operation: "read-gallery-entries", galleryEntryIds: ["g1"] as string[] },
] as const)("preserves blocked recovery for $operation", async (request) => {
  const editor = liveAgentEditor({
    projectHost: {
      fetch: async () =>
        Response.json({ error: "account-blocked" }, { status: 403 }),
    },
  });
  await editor.client.connect("session-1.code");
  const before = editor.controller.project;
  const result = await editor.client.projectResource({
    apiVersion: "3.0",
    requestId: "blocked",
    ...request,
  });
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "GALLERY_ACCOUNT_BLOCKED",
      recovery: "fix-input",
      message: expect.stringContaining("Owner"),
    },
  });
  expect(editor.controller.project).toBe(before);
});

it("refuses blocked insertion before any project edit", async () => {
  const editor = liveAgentEditor({
    projectHost: {
      fetch: async () =>
        Response.json({ error: "account-blocked" }, { status: 403 }),
    },
  });
  await editor.client.connect("session-1.code");
  const before = editor.controller.project;
  const result = await editor.client.projectResource({
    apiVersion: "3.0",
    requestId: "insert",
    operation: "insert-gallery-entry",
    galleryEntryId: "g1",
    targetDocumentId: before.topDocumentId,
    expectedRevision: before.documents[0]!.revision,
    expectedStructureRevision: before.structureRevision,
    position: { x: 0, y: 0 },
  });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "GALLERY_ACCOUNT_BLOCKED", recovery: "fix-input" },
  });
  expect(editor.controller.project).toBe(before);
});

it.each([
  [401, {}, "SIGN_IN_REQUIRED", "sign-in", "sign in"],
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

it("preserves an account block through the real Agent list client", async () => {
  const editor = liveAgentEditor({
    projectHost: {
      fetch: async () =>
        Response.json({ error: "account-blocked" }, { status: 403 }),
    },
  });
  await editor.client.connect("session-1.code");
  const result = await editor.client.projectResource({
    apiVersion: "3.0",
    requestId: "blocked-list",
    operation: "list-gallery",
  });
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "GALLERY_ACCOUNT_BLOCKED",
      recovery: "fix-input",
      message: expect.stringContaining("Owner"),
    },
  });
});
