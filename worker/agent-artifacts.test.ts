import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
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

function fixture(limits?: { bytes: number; files: number }) {
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
    // R2 takes one key or a list of up to 1,000.
    delete: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys])
        objects.delete(key);
    },
  };
  const files = new AgentArtifacts(storage, bucket, limits ? { limits } : {});
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
  it("refuses new metadata below the SQLite row limit while existing downloads and ACK remain usable", async () => {
    const f = fixture();
    const descriptor = (await (
      await f.files.handle(
        put("abcdefgh", "retained", { "x-artifact-protocol": "2" }),
        "session",
        "retained",
      )
    ).json()) as { leaseId: string };
    const index = structuredClone(
      f.values.get("agent-artifact-index"),
    ) as Record<
      string,
      {
        key: string;
        bytes: number;
        digest: string;
        complete: boolean;
        resident?: boolean;
      }
    >;
    // Reopen a durable index with tombstones near the documented 1 MiB budget.
    // Each body's identity survives eviction; no R2 body is needed for these.
    let last = "";
    let size = Buffer.byteLength(JSON.stringify(index));
    for (let i = 0; ; i++) {
      const id = `evicted-${i}`;
      const entry = {
        key: `agent-transfers/session/${id}`,
        bytes: 8,
        digest: "0".repeat(64),
        complete: false,
        resident: false,
      };
      const added = Buffer.byteLength(JSON.stringify({ [id]: entry })) - 1;
      if (size + added > 1024 * 1024 - 64) break;
      index[id] = entry;
      size += added;
      last = id;
    }
    index[last]!.key += "a".repeat(
      1024 * 1024 - 64 - Buffer.byteLength(JSON.stringify(index)),
    );
    f.values.set("agent-artifact-index", index);
    const write = f.storage.put;
    f.storage.put = async (key, value) => {
      // Cloudflare SQLite-backed DO key/value records are limited to 2 MB.
      expect(
        Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value)),
      ).toBeLessThan(2_000_000);
      await write(key, value);
    };
    const reopened = new AgentArtifacts(f.storage, f.bucket);
    const count = Object.keys(index).length;
    const response = await reopened.handle(
      put("new", "next"),
      "session",
      "next",
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "ARTIFACT_METADATA_QUOTA_EXCEEDED" },
    });
    expect((await reopened.usage()).identityCount).toBe(count);
    const read = await reopened.handle(
      new Request("https://internal/artifacts/retained", {
        headers: { "x-artifact-lease": descriptor.leaseId },
      }),
      "session",
      "retained",
    );
    expect(await read.text()).toBe("abcdefgh");
    expect(
      (
        await reopened.handle(
          new Request("https://internal/artifacts/retained", {
            method: "DELETE",
            headers: { "x-artifact-lease": descriptor.leaseId },
          }),
          "session",
          "retained",
        )
      ).status,
    ).toBe(200);
    expect((await reopened.usage()).protectedBytes).toBe(0);
  });
  it("rejects a reupload when another admission starts deleting that identity during reclamation", async () => {
    const f = fixture();
    let now = 1000;
    const files = new AgentArtifacts(f.storage, f.bucket, {
      limits: { bytes: 16, files: 2 },
      now: () => now,
    });
    const upload = f.bucket.put;
    f.bucket.put = async () => {
      throw new Error("R2 unavailable");
    };
    for (const id of ["older", "retry"]) {
      expect(
        (await files.handle(put("abcdefgh", id), "session", id)).status,
      ).toBe(502);
      now++;
    }
    now += 10 * 60_000 + 1;
    f.bucket.put = upload;
    const remove = f.bucket.delete;
    const releases = new Map<string, () => void>();
    f.bucket.delete = async (keys) => {
      const key = typeof keys === "string" ? keys : keys[0]!;
      await new Promise<void>((resolve) => releases.set(key, resolve));
      await remove(keys);
    };
    const retry = files.handle(put("abcdefgh", "retry"), "session", "retry");
    await vi.waitFor(() =>
      expect(releases.has("agent-transfers/session/older")).toBe(true),
    );
    const next = files.handle(put("12345678", "next"), "session", "next");
    await vi.waitFor(() =>
      expect(releases.has("agent-transfers/session/retry")).toBe(true),
    );
    releases.get("agent-transfers/session/older")!();
    const response = await retry;
    // Always release the blocked deletion, including on the failing candidate.
    releases.get("agent-transfers/session/retry")!();
    expect((await next).status).toBe(200);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "ARTIFACT_RECLAIM_PENDING" },
    });
    expect(
      (await files.handle(put("abcdefgh", "retry"), "session", "retry")).status,
    ).toBe(200);
    expect(
      await (
        await files.handle(
          new Request("https://internal/artifacts/retry"),
          "session",
          "retry",
        )
      ).text(),
    ).toBe("abcdefgh");
    f.bucket.delete = remove;
    await files.clear();
  });
  it("lets only one admission physically delete an idle identity at a time", async () => {
    const f = fixture({ bytes: 8, files: 1 });
    const descriptor = (await (
      await f.files.handle(
        put("abcdefgh", "first", { "x-artifact-protocol": "2" }),
        "session",
        "first",
      )
    ).json()) as { leaseId: string };
    await f.files.handle(
      new Request("https://internal/artifacts/first", {
        method: "DELETE",
        headers: { "x-artifact-lease": descriptor.leaseId },
      }),
      "session",
      "first",
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const remove = f.bucket.delete;
    let deletions = 0;
    f.bucket.delete = async (keys) => {
      deletions++;
      await gate;
      return remove(keys);
    };
    const one = f.files.handle(
      put("12345678", "second", { "x-artifact-protocol": "2" }),
      "session",
      "second",
    );
    await vi.waitFor(() => expect(deletions).toBe(1));
    const two = f.files.handle(
      put("87654321", "third", { "x-artifact-protocol": "2" }),
      "session",
      "third",
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(deletions).toBe(1);
    release();
    expect((await one).status).toBe(200);
    expect((await two).status).toBe(413);
    expect(f.objects.size).toBe(1);
    f.bucket.delete = remove;
    await f.files.clear();
  });
  it("keeps a failed physical deletion charged and retries it before admitting another upload", async () => {
    const f = fixture({ bytes: 8, files: 1 });
    const descriptor = (await (
      await f.files.handle(
        put("abcdefgh", "first", { "x-artifact-protocol": "2" }),
        "session",
        "first",
      )
    ).json()) as { leaseId: string };
    await f.files.handle(
      new Request("https://internal/artifacts/first", {
        method: "DELETE",
        headers: { "x-artifact-lease": descriptor.leaseId },
      }),
      "session",
      "first",
    );
    const remove = f.bucket.delete;
    f.bucket.delete = async () => {
      throw new Error("R2 unavailable");
    };
    expect(
      (
        await f.files.handle(
          put("12345678", "second", { "x-artifact-protocol": "2" }),
          "session",
          "second",
        )
      ).status,
    ).toBe(413);
    expect(await f.files.usage()).toMatchObject({
      usedBytes: 8,
      pendingReclaimBytes: 8,
      fileCount: 1,
    });
    expect(f.objects.size).toBe(1);
    f.bucket.delete = remove;
    expect(
      (
        await f.files.handle(
          put("12345678", "second", { "x-artifact-protocol": "2" }),
          "session",
          "second",
        )
      ).status,
    ).toBe(200);
    expect(await f.files.usage()).toMatchObject({
      usedBytes: 8,
      pendingReclaimBytes: 0,
      fileCount: 1,
    });
    await f.files.clear();
  });
  it("releases only the acknowledged consumer and protects a stream after both consumers acknowledge", async () => {
    const f = fixture({ bytes: 8, files: 1 });
    const one = (await (
      await f.files.handle(
        put("abcdefgh", "first", { "x-artifact-protocol": "2" }),
        "session",
        "first",
      )
    ).json()) as { leaseId: string };
    const two = (await (
      await f.files.handle(
        put("abcdefgh", "first", { "x-artifact-protocol": "2" }),
        "session",
        "first",
      )
    ).json()) as { leaseId: string };
    const acknowledge = (leaseId: string) =>
      f.files.handle(
        new Request("https://internal/artifacts/first", {
          method: "DELETE",
          headers: { "x-artifact-lease": leaseId },
        }),
        "session",
        "first",
      );
    await acknowledge(one.leaseId);
    expect(
      (
        await f.files.handle(
          put("12345678", "second", { "x-artifact-protocol": "2" }),
          "session",
          "second",
        )
      ).status,
    ).toBe(413);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const get = f.bucket.get;
    f.bucket.get = async (...args) => {
      const object = await get(...args);
      return (
        object && {
          ...object,
          body: new ReadableStream<Uint8Array>({
            async pull(controller) {
              await gate;
              controller.enqueue(new TextEncoder().encode("abcdefgh"));
              controller.close();
            },
          }),
        }
      );
    };
    const response = await f.files.handle(
      new Request("https://internal/artifacts/first", {
        headers: { "x-artifact-lease": two.leaseId },
      }),
      "session",
      "first",
    );
    await acknowledge(two.leaseId);
    expect(
      (
        await f.files.handle(
          put("12345678", "second", { "x-artifact-protocol": "2" }),
          "session",
          "second",
        )
      ).status,
    ).toBe(413);
    release();
    expect(await response.text()).toBe("abcdefgh");
    expect(
      (
        await f.files.handle(
          put("12345678", "second", { "x-artifact-protocol": "2" }),
          "session",
          "second",
        )
      ).status,
    ).toBe(200);
    await f.files.clear();
  });
  it.each(["1", "2"])(
    "recovers a failed upload reservation after reconstruction and its retry deadline (protocol=%s)",
    async (protocol) => {
      const f = fixture();
      let now = 1000;
      const files = new AgentArtifacts(f.storage, f.bucket, {
        limits: { bytes: 8, files: 1 },
        now: () => now,
      });
      const upload = f.bucket.put;
      f.bucket.put = async () => {
        throw new Error("R2 unavailable");
      };
      expect(
        (
          await files.handle(
            put("abcdefgh", "first", { "x-artifact-protocol": protocol }),
            "session",
            "first",
          )
        ).status,
      ).toBe(502);
      const restored = new AgentArtifacts(f.storage, f.bucket, {
        limits: { bytes: 8, files: 1 },
        now: () => now,
      });
      expect(await restored.usage()).toMatchObject({
        reservedBytes: 8,
        protectedBytes: 8,
      });
      f.bucket.put = upload;
      expect(
        (
          await restored.handle(
            put("12345678", "second", { "x-artifact-protocol": "2" }),
            "session",
            "second",
          )
        ).status,
      ).toBe(413);
      now += 10 * 60_000 + 1;
      expect(await restored.usage()).toMatchObject({
        reservedBytes: 8,
        protectedBytes: 0,
        reclaimableBytes: 8,
      });
      await restored.maintenance();
      expect(await restored.usage()).toMatchObject({
        reservedBytes: 0,
        fileCount: 0,
        identityCount: 1,
      });
      expect(
        (
          await restored.handle(
            put("changed!", "first", { "x-artifact-protocol": "2" }),
            "session",
            "first",
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await restored.handle(
            put("12345678", "second", { "x-artifact-protocol": "2" }),
            "session",
            "second",
          )
        ).status,
      ).toBe(200);
      await restored.clear();
    },
  );
  it("serializes identity and capacity reservations before concurrent R2 uploads", async () => {
    const f = fixture({ bytes: 12, files: 3 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = f.bucket.put;
    let writes = 0;
    f.bucket.put = async (...args) => {
      writes++;
      await gate;
      return original(...args);
    };
    const first = f.files.handle(put("aaaa", "same"), "session", "same");
    const conflict = f.files.handle(put("bbbb", "same"), "session", "same");
    await vi.waitFor(() => expect(writes).toBeGreaterThan(0));
    release();
    expect(
      (await Promise.all([first, conflict])).map((response) => response.status),
    ).toEqual([200, 409]);
    expect(writes).toBe(1);
    expect(
      await (
        await f.files.handle(
          new Request("https://internal/artifacts/same"),
          "session",
          "same",
        )
      ).text(),
    ).toBe("aaaa");
    await f.files.clear();
  });
  it("protects a v2 descriptor until ACK, then reclaims its replica while retaining immutable identity", async () => {
    const f = fixture({ bytes: 12, files: 3 });
    const uploaded = await f.files.handle(
      put("abcdefgh", "first", { "x-artifact-protocol": "2" }),
      "session",
      "first",
    );
    const descriptor = (await uploaded.json()) as {
      leaseId: string;
      expiresAt: number;
    };
    expect(descriptor.leaseId).toEqual(expect.any(String));
    expect(
      (
        await f.files.handle(
          put("12345678", "second", { "x-artifact-protocol": "2" }),
          "session",
          "second",
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await f.files.handle(
          new Request("https://internal/artifacts/first", {
            method: "DELETE",
            headers: { "x-artifact-lease": descriptor.leaseId },
          }),
          "session",
          "first",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await f.files.handle(
          put("12345678", "second", { "x-artifact-protocol": "2" }),
          "session",
          "second",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await f.files.handle(
          new Request("https://internal/artifacts/first"),
          "session",
          "first",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await f.files.handle(
          put("changed!", "first", { "x-artifact-protocol": "2" }),
          "session",
          "first",
        )
      ).status,
    ).toBe(409);
    expect(f.objects.size).toBe(1);
    await f.files.clear();
  });
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
    const replica = (await (
      await object.fetch(
        put("leased", "leased", {
          "x-editor-secret": session.editorSecret,
          "x-artifact-protocol": "2",
        }),
      )
    ).json()) as { leaseId: string };
    const acknowledgement = () =>
      new Request("https://internal/files", {
        method: "POST",
        headers: {
          authorization: `Bearer ${claim.claim.agentToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          apiVersion: "3.0",
          requestId: "ack",
          operation: "simulation-input",
          input: {
            action: "release-download",
            fileId: "leased",
            leaseId: replica.leaseId,
          },
        }),
      });
    expect(await (await object.fetch(acknowledgement())).json()).toMatchObject({
      ok: true,
      result: { ok: true, released: true },
    });
    expect(await (await object.fetch(acknowledgement())).json()).toMatchObject({
      ok: true,
      result: { ok: true, released: true },
    }); // exact request replay
    expect(
      (
        await object.fetch(
          new Request("https://internal/artifacts/leased", {
            method: "DELETE",
            headers: {
              "x-editor-secret": session.editorSecret,
              "x-artifact-lease": replica.leaseId,
            },
          }),
        )
      ).status,
    ).toBe(401);
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

describe("an ended session's downloads", () => {
  /** A claimed session with two uploaded files, as a fresh object sees it. */
  async function session() {
    const f = fixture();
    let alarm: number | undefined;
    const deletes: string[][] = [];
    let failDeletes = false;
    const storage = {
      ...f.storage,
      setAlarm: async (time: number) => {
        alarm = time;
      },
    };
    const bucket: AgentArtifactBucket = {
      ...f.bucket,
      delete: async (keys) => {
        if (failDeletes) throw new Error("Too many subrequests.");
        const list = Array.isArray(keys) ? keys : [keys];
        deletes.push(list);
        for (const key of list) f.objects.delete(key);
      },
    };
    let counter = 0;
    const { machine, session } = AgentSessionMachine.create({
      projectSessionId: "work",
      projectId: "project",
      documentIds: ["doc"],
      scopes: ["simulation.run"],
      now: Date.now(),
      random: () => `secret-${counter++}`,
    });
    await storage.put(SESSION_STATE_KEY, machine.serialize());
    const open = () =>
      new AgentSessionDO({ storage }, { SIMULATION_ARTIFACTS: bucket });
    const object = open();
    for (const file of ["a", "b"])
      expect(
        (
          await object.fetch(
            put(file, file, { "x-editor-secret": session.editorSecret }),
          )
        ).status,
      ).toBe(200);
    return {
      ...f,
      storage,
      deletes,
      open,
      editorSecret: session.editorSecret,
      alarm: () => alarm,
      failDeletes: (fail: boolean) => {
        failDeletes = fail;
      },
    };
  }

  it("deletes them from R2 in one bulk call", async () => {
    const s = await session();
    const object = s.open();
    await object.fetch(
      new Request("https://internal/control", {
        method: "POST",
        headers: {
          "x-editor-secret": s.editorSecret,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "revoke" }),
      }),
    );
    expect(s.objects.size).toBe(0);
    expect(s.deletes).toHaveLength(1);
    expect(s.deletes[0]).toHaveLength(2);
  });

  it("ends an expired session that R2 cannot clear yet, and retries on an alarm", async () => {
    // Expired while the object was away: restoring it ends the session. A
    // failed delete there used to fail the object's start-up, so every
    // request to it, the editor's status polls included, threw.
    const s = await session();
    const state = s.values.get(SESSION_STATE_KEY) as { expiresAt: number };
    s.values.set(SESSION_STATE_KEY, { ...state, expiresAt: Date.now() - 1 });
    s.failDeletes(true);
    const object = s.open();

    const status = await object.fetch(
      new Request("https://internal/status", {
        headers: { "x-editor-secret": s.editorSecret },
      }),
    );
    expect(status.status).toBeGreaterThanOrEqual(400);
    expect(status.status).toBeLessThan(500);
    expect(s.values.has(SESSION_STATE_KEY)).toBe(false);
    expect(s.objects.size).toBe(2);
    expect(s.alarm()).toBeGreaterThan(Date.now());

    s.failDeletes(false);
    await object.alarm();
    expect(s.objects.size).toBe(0);
    await object.alarm();
    expect(s.deletes).toHaveLength(1);
  });
});
