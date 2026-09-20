import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AgentSessionMachine } from "@icm/agent-adapter";
import {
  AgentArtifacts,
  MAX_AGENT_ARTIFACT_BYTES,
  type AgentArtifactBucket,
} from "./agent-artifacts";
import { AgentSessionDO } from "./agent-session-do";
import {
  routeAgentSessionRequest,
  SESSION_STATE_KEY,
} from "./agent-session-runtime";

function fixture() {
  const values = new Map<string, unknown>();
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const storage = {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async <T>(key: string, value: T) => {
      values.set(key, structuredClone(value));
    },
    deleteAll: async () => {
      values.clear();
    },
  };
  const bucket: AgentArtifactBucket = {
    put: async (key, body, options) => {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      if (createHash("sha256").update(bytes).digest("hex") !== options.sha256)
        throw new Error("R2 checksum mismatch");
      objects.set(key, {
        bytes,
        contentType: options.httpMetadata.contentType,
      });
    },
    get: async (key, options) => {
      const object = objects.get(key);
      if (!object) return null;
      const { range } = options ?? {};
      const bytes = range
        ? object.bytes.slice(range.offset, range.offset + range.length)
        : object.bytes;
      return {
        body: new Response(new Uint8Array(bytes)).body!,
        size: object.bytes.length,
        httpMetadata: { contentType: object.contentType },
      };
    },
    delete: async (key) => {
      objects.delete(key);
    },
  };
  const files = new AgentArtifacts(storage, bucket);
  return { values, storage, bucket, files, objects };
}
function put(
  text: string,
  fileId = "file",
  headers: Record<string, string> = {},
) {
  const ref = {
    id: "locator",
    fileId,
    name: "out.raw",
    mediaType: "text/plain",
    byteLength: Buffer.byteLength(text),
    sha256: createHash("sha256").update(text).digest("hex"),
  };
  return new Request(`https://internal/artifacts/${fileId}`, {
    method: "PUT",
    body: text,
    headers: {
      "content-length": String(ref.byteLength),
      "x-artifact-ref": encodeURIComponent(JSON.stringify(ref)),
      ...headers,
    },
  });
}
describe("authorized streaming artifact transfer", () => {
  it("stores immutable bytes, resumes by byte range, and survives service reconstruction", async () => {
    const f = fixture();
    expect(
      (await f.files.handle(put("a中文z"), "session", "file")).status,
    ).toBe(200);
    const restored = new AgentArtifacts(f.storage, f.bucket);
    const repeated = put("a中文z");
    expect((await restored.handle(repeated, "session", "file")).status).toBe(
      200,
    );
    expect(repeated.bodyUsed).toBe(true);
    const overlong = new Request(repeated.url, {
      method: "PUT",
      headers: repeated.headers,
      body: "unexpected extra bytes",
    });
    expect((await restored.handle(overlong, "session", "file")).status).toBe(
      400,
    );
    const full = await restored.handle(
      new Request("https://internal/artifacts/file"),
      "session",
      "file",
    );
    expect(await full.text()).toBe("a中文z");
    const ranged = await restored.handle(
      new Request("https://internal/artifacts/file", {
        headers: { range: "bytes=1-3", "if-range": full.headers.get("etag")! },
      }),
      "session",
      "file",
    );
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 1-3/8");
    expect(await ranged.text()).toBe("中");
    expect(
      (await restored.handle(put("different"), "session", "file")).status,
    ).toBe(409);
    expect(
      (
        await restored.handle(
          new Request("https://internal/artifacts/file", {
            headers: { range: "bytes=9-" },
          }),
          "session",
          "file",
        )
      ).status,
    ).toBe(416);
    await restored.clear();
    expect(f.objects.size).toBe(0);
  });
  it("does not inherit the RPC body budget or turn downloads into JSON", async () => {
    const text = "x".repeat(3 * 1024 * 1024);
    let bytes = 0;
    const request = put(text);
    const response = await routeAgentSessionRequest(
      new Request(
        "https://example.test/api/agent/sessions/session/artifacts/file",
        request,
      ),
      {
        AGENT_SESSION: {
          getByName: () => ({
            fetch: async (input) => {
              bytes = (
                await new Response((input as Request).body).arrayBuffer()
              ).byteLength;
              return new Response("stored");
            },
          }),
        },
      },
    );
    expect(response?.status).toBe(200);
    expect(bytes).toBe(text.length);
  });
  it("rejects metadata, declared capacity and content integrity errors without publishing a file", async () => {
    const f = fixture();
    expect(
      (await f.files.handle(put("x", "other"), "session", "file")).status,
    ).toBe(400);
    const invalid = put("x");
    const ref = JSON.parse(
      decodeURIComponent(invalid.headers.get("x-artifact-ref")!),
    );
    ref.byteLength = MAX_AGENT_ARTIFACT_BYTES + 1;
    invalid.headers.set(
      "x-artifact-ref",
      encodeURIComponent(JSON.stringify(ref)),
    );
    expect((await f.files.handle(invalid, "session", "file")).status).toBe(413);
    const corrupted = put("x");
    const wrong = JSON.parse(
      decodeURIComponent(corrupted.headers.get("x-artifact-ref")!),
    );
    wrong.sha256 = "0".repeat(64);
    corrupted.headers.set(
      "x-artifact-ref",
      encodeURIComponent(JSON.stringify(wrong)),
    );
    expect((await f.files.handle(corrupted, "session", "file")).status).toBe(
      502,
    );
    expect(
      (
        await f.files.handle(
          new Request("https://internal/artifacts/file"),
          "session",
          "file",
        )
      ).status,
    ).toBe(404);
  });
  it("uses editor authority for upload and scoped Agent authority for download, without an attached browser", async () => {
    const f = fixture();
    let counter = 0;
    const { machine, session } = AgentSessionMachine.create({
      projectSessionId: "work",
      projectId: "project",
      documentIds: ["doc"],
      scopes: ["simulation.run"],
      now: Date.now(),
      random: () => `secret-${counter++}`,
    });
    const claim = machine.redeemClaim(session.claimCode, Date.now());
    if (!claim.ok) throw new Error("claim");
    await f.storage.put(SESSION_STATE_KEY, machine.serialize());
    const object = new AgentSessionDO(
      { storage: f.storage },
      { SIMULATION_ARTIFACTS: f.bucket },
    );
    expect((await object.fetch(put("data"))).status).toBe(401);
    expect(
      (
        await object.fetch(
          put("data", "file", {
            authorization: `Bearer ${claim.claim.agentToken}`,
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await object.fetch(
          put("data", "file", { "x-editor-secret": session.editorSecret }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await object.fetch(new Request("https://internal/artifacts/file")))
        .status,
    ).toBe(401);
    const get = await object.fetch(
      new Request("https://internal/artifacts/file", {
        headers: { authorization: `Bearer ${claim.claim.agentToken}` },
      }),
    );
    expect(get.status).toBe(200);
    expect(await get.text()).toBe("data");
    await object.fetch(
      new Request("https://internal/control", {
        method: "POST",
        headers: {
          "x-editor-secret": session.editorSecret,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "revoke" }),
      }),
    );
    expect(f.objects.size).toBe(0);
    expect(
      (
        await object.fetch(
          new Request("https://internal/artifacts/file", {
            headers: { authorization: `Bearer ${claim.claim.agentToken}` },
          }),
        )
      ).status,
    ).not.toBe(200);
  });
});
