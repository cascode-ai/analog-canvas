import {
  ArtifactRefSchema,
  MAX_ARTIFACT_BYTES,
  type ArtifactRef,
} from "@icm/simulation-service";
import type { DurableStorageLike } from "./agent-session-runtime";

// Byte transfer limits, independent of JSON/RPC preview budgets.
export const MAX_AGENT_ARTIFACT_BYTES = MAX_ARTIFACT_BYTES;
export const MAX_AGENT_ARTIFACT_TOTAL_BYTES = 1024 * 1024 * 1024;
const INDEX_KEY = "agent-artifact-index";
type Entry = { key: string; bytes: number; digest: string; complete: boolean };
export interface AgentArtifactBucket {
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<{
    body: ReadableStream<Uint8Array>;
    size: number;
    httpMetadata?: { contentType?: string };
  } | null>;
  put(
    key: string,
    value: ReadableStream<Uint8Array>,
    options: {
      sha256: string;
      httpMetadata: { contentType: string };
    },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

/** Session-scoped transfer replicas. Canonical run evidence has its own retention. */
export class AgentArtifacts {
  private index: Record<string, Entry> = {};
  private readonly ready: Promise<void>;
  private readonly pending = new Map<string, Promise<Response>>();
  private closing = false;
  constructor(
    private storage: DurableStorageLike,
    private bucket?: AgentArtifactBucket,
  ) {
    this.ready = storage.get<Record<string, Entry>>(INDEX_KEY).then((value) => {
      this.index = value ?? {};
    });
  }
  async clear(): Promise<void> {
    await this.ready;
    this.closing = true;
    await Promise.allSettled(this.pending.values());
    if (this.bucket)
      await Promise.all(
        Object.values(this.index).map(({ key }) => this.bucket!.delete(key)),
      );
    this.index = {};
    await this.storage.put(INDEX_KEY, {});
  }
  async handle(
    request: Request,
    sessionId: string,
    fileId: string,
  ): Promise<Response> {
    await this.ready;
    if (this.closing) return this.error("SESSION_CLOSED", 410);
    if (!this.bucket) return this.error("ARTIFACT_STORAGE_UNAVAILABLE", 503);
    if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(fileId))
      return this.error("INVALID_FILE_ID", 400);
    if (request.method === "PUT") {
      const encoded = request.headers.get("x-artifact-ref");
      let ref: ArtifactRef;
      try {
        if (!encoded || encoded.length > 8192) throw new Error("metadata");
        ref = ArtifactRefSchema.parse(JSON.parse(decodeURIComponent(encoded)));
      } catch {
        return this.error("INVALID_ARTIFACT_METADATA", 400);
      }
      if ((ref.fileId ?? ref.id) !== fileId)
        return this.error("FILE_ID_MISMATCH", 400);
      if (ref.byteLength > MAX_AGENT_ARTIFACT_BYTES)
        return this.error("ARTIFACT_TOO_LARGE", 413);
      if (
        !request.body ||
        request.headers.get("content-length") !== String(ref.byteLength)
      )
        return this.error("ARTIFACT_LENGTH_REQUIRED", 400);
      const existing = this.index[fileId];
      if (
        existing &&
        (existing.digest !== ref.sha256 || existing.bytes !== ref.byteLength)
      )
        return this.error("ARTIFACT_ID_CONFLICT", 409);
      if (existing?.complete) {
        if (!(await this.discardBody(request, ref.byteLength)))
          return this.error("ARTIFACT_LENGTH_MISMATCH", 400);
        return this.receipt(sessionId, fileId, ref.byteLength);
      }
      const inFlight = this.pending.get(fileId);
      if (inFlight) {
        if (!(await this.discardBody(request, ref.byteLength)))
          return this.error("ARTIFACT_LENGTH_MISMATCH", 400);
        return (await inFlight).clone();
      }
      if (
        !existing &&
        (Object.keys(this.index).length >= 1024 ||
          Object.values(this.index).reduce(
            (sum, entry) => sum + entry.bytes,
            0,
          ) +
            ref.byteLength >
            MAX_AGENT_ARTIFACT_TOTAL_BYTES)
      )
        return this.error("ARTIFACT_QUOTA_EXCEEDED", 413);
      const entry: Entry = {
        key: `agent-transfers/${sessionId}/${fileId}`,
        bytes: ref.byteLength,
        digest: ref.sha256,
        complete: false,
      };
      this.index[fileId] = entry;
      const upload = this.upload(request, ref, entry, sessionId, fileId);
      this.pending.set(fileId, upload);
      try {
        return (await upload).clone();
      } finally {
        this.pending.delete(fileId);
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      return this.error("METHOD_NOT_ALLOWED", 405);
    const entry = this.index[fileId];
    if (!entry?.complete) return this.error("ARTIFACT_UNAVAILABLE", 404);
    const etag = `"${entry.digest}"`;
    const rangeHeader = request.headers.get("range");
    let range: { offset: number; length: number } | undefined;
    if (
      rangeHeader &&
      (!request.headers.has("if-range") ||
        request.headers.get("if-range") === etag)
    ) {
      const match = /^bytes=(\d+)-(\d*)$/u.exec(rangeHeader);
      const start = match ? Number(match[1]) : NaN;
      const end = match?.[2]
        ? Math.min(Number(match[2]), entry.bytes - 1)
        : entry.bytes - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start > end
      )
        return new Response(null, {
          status: 416,
          headers: { "content-range": `bytes */${entry.bytes}` },
        });
      range = { offset: start, length: end - start + 1 };
    }
    const object = await this.bucket.get(
      entry.key,
      range ? { range } : undefined,
    );
    if (!object) return this.error("ARTIFACT_UNAVAILABLE", 404);
    const headers = new Headers({
      "content-type":
        object.httpMetadata?.contentType ?? "application/octet-stream",
      "content-length": String(range?.length ?? entry.bytes),
      "cache-control": "private, no-store",
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
      "content-disposition": "attachment",
      etag,
    });
    if (range)
      headers.set(
        "content-range",
        `bytes ${range.offset}-${range.offset + range.length - 1}/${entry.bytes}`,
      );
    if (request.method === "HEAD") await object.body.cancel();
    return new Response(request.method === "HEAD" ? null : object.body, {
      status: range ? 206 : 200,
      headers,
    });
  }
  private async discardBody(request: Request, expectedBytes: number) {
    // A resumed publication may already exist. Finish the inbound stream before
    // replying, without buffering or re-hashing immutable existing evidence.
    let bytes = 0;
    try {
      await request.body!.pipeTo(
        new WritableStream<Uint8Array>({
          write(chunk) {
            bytes += chunk.byteLength;
            if (bytes > expectedBytes) throw new Error("length");
          },
        }),
      );
      return bytes === expectedBytes;
    } catch {
      return false;
    }
  }
  private async upload(
    request: Request,
    ref: ArtifactRef,
    entry: Entry,
    sessionId: string,
    fileId: string,
  ): Promise<Response> {
    try {
      await this.storage.put(INDEX_KEY, structuredClone(this.index));
      // Incoming HTTP bodies have a known length. R2 validates the producer's
      // checksum while streaming; do not buffer or re-hash the payload in the DO.
      await this.bucket!.put(entry.key, request.body!, {
        sha256: ref.sha256,
        httpMetadata: { contentType: ref.mediaType },
      });
      entry.complete = true;
      await this.storage.put(INDEX_KEY, structuredClone(this.index));
      return this.receipt(sessionId, fileId, ref.byteLength);
    } catch {
      // Leave a bounded reservation for an identical retry or session cleanup.
      entry.complete = false;
      return this.error("ARTIFACT_UPLOAD_FAILED", 502);
    }
  }
  private receipt(
    sessionId: string,
    fileId: string,
    byteLength: number,
  ): Response {
    return Response.json(
      {
        ok: true,
        path: `/api/agent/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(fileId)}`,
        byteLength,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  private error(code: string, status: number): Response {
    return Response.json(
      { ok: false, error: { code } },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
