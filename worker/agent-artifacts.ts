import {
  ArtifactRefSchema,
  MAX_ARTIFACT_BYTES,
  type ArtifactRef,
} from "@icm/simulation-service";
import type { DurableStorageLike } from "./agent-session-runtime";

// Byte transfer limits, independent of JSON/RPC preview budgets.
export const MAX_AGENT_ARTIFACT_BYTES = MAX_ARTIFACT_BYTES;
const MAX_AGENT_ARTIFACT_TOTAL_BYTES = 1024 * 1024 * 1024;
const INDEX_KEY = "agent-artifact-index";
type Entry = {
  key: string;
  bytes: number;
  digest: string;
  complete: boolean;
  resident?: boolean;
  legacy?: boolean;
  touched?: number;
  retryUntil?: number;
  evicting?: boolean;
  leases?: Record<string, number>;
};
const LEASE_MS = 10 * 60_000;
const MAX_IDENTITIES = 65_536;
// The durable index occupies one SQLite-backed DO key/value record (2 MB max).
// Leave serialization/headroom for renewals and ACKs below that platform limit.
const MAX_IDENTITY_BYTES = 1024 * 1024;
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
  delete(keys: string | string[]): Promise<void>;
}
/** R2 deletes at most this many keys in one call. */
const BULK_DELETE_KEYS = 1000;

/** Session-scoped transfer replicas. Canonical run evidence has its own retention. */
export class AgentArtifacts {
  private index: Record<string, Entry> = {};
  private readonly ready: Promise<void>;
  private readonly pending = new Map<string, Promise<Response>>();
  private closing = false;
  private writes: Promise<unknown> = Promise.resolve();
  private active = new Map<string, number>();
  private deleting = new Set<string>();
  constructor(
    private storage: DurableStorageLike,
    private bucket?: AgentArtifactBucket,
    private options: {
      limits?: { bytes: number; files: number };
      now?: () => number;
    } = {},
  ) {
    this.ready = storage.get<Record<string, Entry>>(INDEX_KEY).then((value) => {
      this.index = Object.assign(
        Object.create(null) as Record<string, Entry>,
        value ?? {},
      );
    });
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.writes.then(action);
    this.writes = result.catch(() => {});
    return result;
  }
  private persist() {
    return this.storage.put(INDEX_KEY, structuredClone(this.index));
  }
  private resident(entry: Entry) {
    return entry.resident !== false;
  }
  private fits(bytes: number, files: number) {
    const resident = Object.values(this.index).filter((entry) =>
      this.resident(entry),
    );
    return (
      resident.length + files <= (this.options.limits?.files ?? 1024) &&
      resident.reduce((sum, entry) => sum + entry.bytes, bytes) <=
        (this.options.limits?.bytes ?? MAX_AGENT_ARTIFACT_TOTAL_BYTES)
    );
  }
  /** Mark before R2 IO; only successful deletion releases the charged reservation. */
  private async reclaim(bytes: number, files: number) {
    const attempted = new Set<string>();
    while (true) {
      const selected = await this.serial(async () => {
        const now = this.now();
        const candidate = Object.entries(this.index)
          .filter(
            ([id, entry]) =>
              this.resident(entry) &&
              !attempted.has(id) &&
              !this.deleting.has(id) &&
              (entry.legacy === false || !entry.complete) &&
              !this.pending.has(id) &&
              !this.active.has(id) &&
              !(entry.retryUntil && entry.retryUntil > now) &&
              !Object.values(entry.leases ?? {}).some(
                (expires) => expires > now,
              ) &&
              (entry.evicting || !entry.complete || !this.fits(bytes, files)),
          )
          .sort(
            (a, b) =>
              Number(Boolean(b[1].evicting)) - Number(Boolean(a[1].evicting)) ||
              (a[1].touched ?? 0) - (b[1].touched ?? 0),
          )[0];
        if (!candidate) return undefined;
        candidate[1].evicting = true;
        this.deleting.add(candidate[0]);
        try {
          await this.persist();
        } catch (error) {
          this.deleting.delete(candidate[0]);
          throw error;
        }
        return candidate;
      });
      if (!selected) return;
      const [id, entry] = selected;
      attempted.add(id);
      try {
        await this.bucket!.delete(entry.key);
        await this.serial(async () => {
          entry.resident = false;
          entry.complete = false;
          entry.evicting = false;
          entry.leases = {};
          delete entry.retryUntil;
          await this.persist();
        });
      } catch {
        // Keep evicting and its bytes charged. A later admission retries it.
      } finally {
        this.deleting.delete(id);
      }
    }
  }
  async maintenance(): Promise<void> {
    await this.ready;
    if (!this.closing && this.bucket) await this.reclaim(0, 0);
  }
  async nextMaintenanceAt(): Promise<number | undefined> {
    await this.ready;
    const deadlines = Object.values(this.index).flatMap((entry) =>
      entry.evicting
        ? [this.now() + 60_000]
        : !entry.complete && this.resident(entry)
          ? [entry.retryUntil ?? this.now() + LEASE_MS]
          : [],
    );
    return deadlines.length
      ? Math.max(this.now() + 1000, Math.min(...deadlines))
      : undefined;
  }
  async usage() {
    await this.ready;
    const resident = Object.entries(this.index).filter(([, entry]) =>
      this.resident(entry),
    );
    const protectedEntry = ([id, entry]: [string, Entry]) =>
      (entry.complete && entry.legacy !== false) ||
      this.pending.has(id) ||
      this.active.has(id) ||
      (entry.retryUntil ?? 0) > this.now() ||
      Object.values(entry.leases ?? {}).some((expires) => expires > this.now());
    return {
      scope: "agent-session-transfer" as const,
      usedBytes: resident
        .filter(([, entry]) => entry.complete)
        .reduce((sum, [, entry]) => sum + entry.bytes, 0),
      reservedBytes: resident
        .filter(([, entry]) => !entry.complete)
        .reduce((sum, [, entry]) => sum + entry.bytes, 0),
      protectedBytes: resident
        .filter(protectedEntry)
        .reduce((sum, [, entry]) => sum + entry.bytes, 0),
      reclaimableBytes: resident
        .filter((item) => !protectedEntry(item))
        .reduce((sum, [, entry]) => sum + entry.bytes, 0),
      pendingReclaimBytes: resident
        .filter(([, entry]) => entry.evicting)
        .reduce((sum, [, entry]) => sum + entry.bytes, 0),
      fileCount: resident.length,
      identityCount: Object.keys(this.index).length,
      byteLimit: this.options.limits?.bytes ?? MAX_AGENT_ARTIFACT_TOTAL_BYTES,
      fileLimit: this.options.limits?.files ?? 1024,
    };
  }
  /**
   * Forget every transfer, then delete its bytes. Returns the keys still
   * stored, for the session to retry: it ends whether or not R2 takes them.
   */
  async clear(): Promise<string[]> {
    await this.ready;
    this.closing = true;
    await Promise.allSettled(this.pending.values());
    const keys = Object.values(this.index).map(({ key }) => key);
    this.index = Object.create(null) as Record<string, Entry>;
    await this.storage.put(INDEX_KEY, {});
    return this.deleteObjects(keys);
  }

  /**
   * Delete stored bytes in bulk calls and return the keys left. One call per
   * object had sent a session's every download to R2 at once when it
   * expired; when that failed, the session could neither end nor answer.
   */
  async deleteObjects(keys: readonly string[]): Promise<string[]> {
    if (!this.bucket) return [];
    let left = [...keys];
    try {
      while (left.length) {
        await this.bucket.delete(left.slice(0, BULK_DELETE_KEYS));
        left = left.slice(BULK_DELETE_KEYS);
      }
    } catch (error) {
      console.error("Agent artifact deletion deferred", error);
    }
    return left;
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
    if (request.method === "DELETE") {
      const leaseId = request.headers.get("x-artifact-lease");
      return this.serial(async () => {
        const entry = this.index[fileId];
        if (!leaseId || !entry?.leases?.[leaseId])
          return this.error("ARTIFACT_LEASE_UNAVAILABLE", 404);
        delete entry.leases[leaseId];
        entry.touched = this.now();
        await this.persist();
        return Response.json({ ok: true, released: true });
      });
    }
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
      if (existing?.evicting)
        return this.error("ARTIFACT_RECLAIM_PENDING", 503);
      if (existing?.complete) {
        this.active.set(fileId, (this.active.get(fileId) ?? 0) + 1);
        try {
          if (!(await this.discardBody(request, ref.byteLength)))
            return this.error("ARTIFACT_LENGTH_MISMATCH", 400);
          return await this.receipt(
            sessionId,
            fileId,
            ref.byteLength,
            request.headers.get("x-artifact-protocol") === "2",
          );
        } finally {
          const count = (this.active.get(fileId) ?? 1) - 1;
          if (count) this.active.set(fileId, count);
          else this.active.delete(fileId);
        }
      }
      const inFlight = this.pending.get(fileId);
      if (inFlight) {
        if (!(await this.discardBody(request, ref.byteLength)))
          return this.error("ARTIFACT_LENGTH_MISMATCH", 400);
        const response = await inFlight;
        return response.ok
          ? this.receipt(
              sessionId,
              fileId,
              ref.byteLength,
              request.headers.get("x-artifact-protocol") === "2",
            )
          : response.clone();
      }
      await this.reclaim(
        existing && this.resident(existing) ? 0 : ref.byteLength,
        existing && this.resident(existing) ? 0 : 1,
      );
      const reserved = await this.serial(async () => {
        if (this.closing) return this.error("SESSION_CLOSED", 410);
        const current = this.index[fileId];
        if (current?.evicting)
          return this.error("ARTIFACT_RECLAIM_PENDING", 503);
        if (
          current &&
          (current.digest !== ref.sha256 || current.bytes !== ref.byteLength)
        )
          return this.error("ARTIFACT_ID_CONFLICT", 409);
        if (current !== existing && current)
          return this.error("ARTIFACT_TRANSFER_BUSY", 503);
        if (
          !existing &&
          (Object.keys(this.index).length >= MAX_IDENTITIES ||
            new TextEncoder().encode(JSON.stringify(this.index)).byteLength >
              MAX_IDENTITY_BYTES)
        )
          return this.error("ARTIFACT_METADATA_QUOTA_EXCEEDED", 413);
        if (
          !this.fits(
            existing && this.resident(existing) ? 0 : ref.byteLength,
            existing && this.resident(existing) ? 0 : 1,
          )
        )
          return this.error("ARTIFACT_QUOTA_EXCEEDED", 413);
        const entry: Entry = {
          key: `agent-transfers/${sessionId}/${fileId}`,
          bytes: ref.byteLength,
          digest: ref.sha256,
          complete: false,
          resident: true,
          legacy:
            request.headers.get("x-artifact-protocol") !== "2" ||
            existing?.legacy === true,
          touched: this.now(),
          retryUntil: this.now() + LEASE_MS,
          leases: existing?.leases ?? {},
        };
        if (
          new TextEncoder().encode(
            JSON.stringify({ ...this.index, [fileId]: entry }),
          ).byteLength > MAX_IDENTITY_BYTES
        )
          return this.error("ARTIFACT_METADATA_QUOTA_EXCEEDED", 413);
        this.index[fileId] = entry;
        await this.persist();
        return entry;
      });
      if (reserved instanceof Response) return reserved;
      const entry = reserved;
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
    if (!entry?.complete || entry.evicting)
      return this.error("ARTIFACT_UNAVAILABLE", 404);
    const leaseId = request.headers.get("x-artifact-lease");
    if (leaseId && (entry.leases?.[leaseId] ?? 0) <= this.now())
      return this.error("ARTIFACT_LEASE_EXPIRED", 410);
    if (!leaseId && entry.legacy === false)
      return this.error("ARTIFACT_LEASE_REQUIRED", 403);
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
    this.active.set(fileId, (this.active.get(fileId) ?? 0) + 1);
    const release = () => {
      const count = (this.active.get(fileId) ?? 1) - 1;
      if (count) this.active.set(fileId, count);
      else this.active.delete(fileId);
    };
    const renew = () =>
      this.serial(async () => {
        entry.touched = this.now();
        if (leaseId) entry.leases![leaseId] = this.now() + LEASE_MS;
        await this.persist();
      });
    try {
      await renew();
    } catch (error) {
      release();
      throw error;
    }
    let object;
    try {
      object = await this.bucket.get(entry.key, range ? { range } : undefined);
    } catch (error) {
      release();
      throw error;
    }
    if (!object) {
      release();
      return this.error("ARTIFACT_UNAVAILABLE", 404);
    }
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
    if (request.method === "HEAD") {
      await object.body.cancel();
      release();
    }
    let body: ReadableStream<Uint8Array> | null = null;
    if (request.method !== "HEAD") {
      const reader = object.body.getReader();
      const timer = setInterval(() => {
        void renew().catch(() => {});
      }, 60_000);
      (timer as unknown as { unref?: () => void }).unref?.();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        release();
      };
      body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const item = await reader.read();
            if (item.done) {
              finish();
              controller.close();
            } else controller.enqueue(item.value);
          } catch (error) {
            finish();
            controller.error(error);
          }
        },
        async cancel(reason) {
          finish();
          await reader.cancel(reason);
        },
      });
    }
    return new Response(body, {
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
      await this.serial(() => this.persist());
      // Incoming HTTP bodies have a known length. R2 validates the producer's
      // checksum while streaming; do not buffer or re-hash the payload in the DO.
      await this.bucket!.put(entry.key, request.body!, {
        sha256: ref.sha256,
        httpMetadata: { contentType: ref.mediaType },
      });
      entry.complete = true;
      delete entry.retryUntil;
      await this.serial(() => this.persist());
      return this.receipt(
        sessionId,
        fileId,
        ref.byteLength,
        request.headers.get("x-artifact-protocol") === "2",
      );
    } catch {
      // Leave a bounded reservation for an identical retry or session cleanup.
      entry.complete = false;
      entry.retryUntil = this.now() + LEASE_MS;
      await this.serial(() => this.persist());
      return this.error("ARTIFACT_UPLOAD_FAILED", 502);
    }
  }
  private async receipt(
    sessionId: string,
    fileId: string,
    byteLength: number,
    leased = false,
  ): Promise<Response> {
    const protection = await this.serial(async () => {
      const entry = this.index[fileId];
      if (this.closing) return this.error("SESSION_CLOSED", 410);
      if (!entry?.complete || entry.evicting || !this.resident(entry))
        return this.error("ARTIFACT_UNAVAILABLE", 404);
      if (!leased) {
        entry.legacy = true;
        await this.persist();
        return {};
      }
      const leaseId = crypto.randomUUID();
      const expiresAt = this.now() + LEASE_MS;
      entry.leases ??= {};
      for (const [id, expires] of Object.entries(entry.leases))
        if (expires <= this.now()) delete entry.leases[id];
      if (Object.keys(entry.leases).length >= 1024)
        return this.error("ARTIFACT_LEASE_CAPACITY", 503);
      entry.leases[leaseId] = expiresAt;
      if (
        new TextEncoder().encode(JSON.stringify(this.index)).byteLength >
        MAX_IDENTITY_BYTES
      ) {
        delete entry.leases[leaseId];
        return this.error("ARTIFACT_METADATA_QUOTA_EXCEEDED", 413);
      }
      await this.persist();
      return { leaseId, expiresAt };
    });
    if (protection instanceof Response) return protection;
    return Response.json(
      {
        ok: true,
        path: `/api/agent/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(fileId)}`,
        byteLength,
        ...protection,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  private error(code: string, status: number): Response {
    return Response.json(
      {
        ok: false,
        error: {
          code,
          message:
            code === "ARTIFACT_QUOTA_EXCEEDED"
              ? "Download replica capacity is full; original project evidence remains available"
              : code === "ARTIFACT_LEASE_EXPIRED"
                ? "Prepare a new lease for the same original artifact"
                : code === "ARTIFACT_UNAVAILABLE"
                  ? "Prepare the original artifact again; its transfer replica is unavailable"
                  : code,
        },
      },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
