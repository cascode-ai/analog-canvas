import type {
  AnalyticsSummary,
  DurableObjectStateLike,
  PageLoadEvent,
  PageViewEvent,
} from "./worker";

export const ANALYTICS_SYNC_RETENTION_DAYS = 7;

export type AnalyticsEvent = {
  sequence: number;
  kind: "hit" | "load";
  collectedAt: number;
  payload: PageViewEvent | PageLoadEvent;
};
export type AnalyticsBatch = {
  epoch: string;
  after: number;
  events: AnalyticsEvent[];
};
export type AnalyticsReceipt = {
  epoch: string;
  through: number;
  hash: string;
  summary: AnalyticsSummary;
};
export type AnalyticsBaseline = { epoch: string; snapshot: unknown };
export type AnalyticsStatus = {
  mode: string;
  epoch: string | null;
  sequence: number;
  acknowledged: number;
  seeded: boolean;
  pending: number;
  oldestPendingAt: number | null;
  cachedAt: string | null;
};

type Hooks = {
  snapshot(): unknown;
  summary(): AnalyticsSummary;
  apply(event: AnalyticsEvent): void;
  seed(snapshot: unknown, minimumDay: number): void;
};

type Peer = {
  epoch: string;
  head: number;
  baselineHash: string;
  lastAfter: number;
  lastHash: string;
};
export class AnalyticsSyncError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validSummary(value: unknown): value is AnalyticsSummary {
  const summary = value as AnalyticsSummary;
  return Boolean(
    summary &&
    Number.isFinite(Date.parse(summary.generatedAt)) &&
    Number.isSafeInteger(summary.totals?.pv) &&
    summary.totals.pv >= 0 &&
    Number.isSafeInteger(summary.totals?.uv) &&
    summary.totals.uv >= 0 &&
    summary.today &&
    Array.isArray(summary.days) &&
    Array.isArray(summary.countries) &&
    Array.isArray(summary.sources) &&
    Array.isArray(summary.paths) &&
    Array.isArray(summary.points) &&
    summary.loadTimes &&
    summary.breakdownTotals,
  );
}

export const ANALYTICS_SYNC_TABLES = [
  "analytics_sync_meta",
  "analytics_outbox",
];

/** Durable collection is local; only a background tick contacts the authority. */
export class AnalyticsReplication {
  private readonly sql;

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly hooks: Hooks,
  ) {
    this.sql = state.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS analytics_sync_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS analytics_outbox(sequence INTEGER PRIMARY KEY, kind TEXT NOT NULL, collected_at INTEGER NOT NULL, payload TEXT NOT NULL)",
    );
  }

  private get<T>(key: string, fallback: T): T {
    const row = this.sql
      .exec<{ value: string }>(
        "SELECT value FROM analytics_sync_meta WHERE key=?",
        key,
      )
      .toArray()[0];
    return row ? (JSON.parse(row.value) as T) : fallback;
  }

  private set(key: string, value: unknown): void {
    this.sql.exec(
      "INSERT INTO analytics_sync_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      key,
      JSON.stringify(value),
    );
  }

  private cache(summary: AnalyticsSummary): void {
    if (!validSummary(summary))
      throw new AnalyticsSyncError("invalid-summary", 400);
    const current = this.summary();
    if (
      current &&
      (Date.parse(summary.generatedAt) < Date.parse(current.generatedAt) ||
        summary.totals.pv < current.totals.pv ||
        summary.totals.uv < current.totals.uv)
    )
      throw new AnalyticsSyncError("stale-summary");
    this.set("summary", summary);
  }

  mode(): string {
    return this.get("mode", "standalone");
  }

  summary(): AnalyticsSummary | null {
    return this.mode() === "collector"
      ? this.get<AnalyticsSummary | null>("summary", null)
      : null;
  }

  enqueue(
    kind: "hit" | "load",
    payload: PageViewEvent | PageLoadEvent,
    collectedAt: number,
  ): void {
    if (this.mode() !== "collector") return;
    const sequence = this.get("sequence", 0) + 1;
    this.sql.exec(
      "INSERT INTO analytics_outbox VALUES (?,?,?,?)",
      sequence,
      kind,
      collectedAt,
      JSON.stringify(payload),
    );
    this.set("sequence", sequence);
  }

  async fetch(request: Request): Promise<Response | null> {
    try {
      return await this.handle(request);
    } catch (error) {
      if (error instanceof AnalyticsSyncError)
        return Response.json(
          { error: error.message },
          { status: error.status },
        );
      if (error instanceof SyntaxError)
        return Response.json({ error: "invalid-json" }, { status: 400 });
      throw error;
    }
  }

  private receipt(epoch: string, through: number, hash: string): Response {
    return Response.json({
      epoch,
      through,
      hash,
      summary: this.hooks.summary(),
    });
  }

  private async handle(request: Request): Promise<Response | null> {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/sync/")) return null;
    if (path === "/sync/prepare" && request.method === "POST") {
      if (!["standalone", "authority"].includes(this.mode()))
        throw new AnalyticsSyncError("not-authority");
      if (this.mode() === "standalone")
        this.set("authorityDay", Math.floor(Date.now() / 86_400_000));
      this.set("mode", "authority");
      return Response.json({
        mode: "authority",
        summary: this.hooks.summary(),
      });
    }
    if (path === "/sync/activate" && request.method === "POST") {
      const body = (await request.json()) as { summary: AnalyticsSummary };
      if (!validSummary(body?.summary))
        return Response.json({ error: "invalid-summary" }, { status: 400 });
      const snapshot = this.hooks.snapshot();
      if (!snapshot || JSON.stringify(snapshot).length > 1024 * 1024)
        return Response.json({ error: "baseline-too-large" }, { status: 413 });
      return this.state.storage.transactionSync(() => {
        if (this.mode() !== "standalone")
          return Response.json(
            { error: "already-configured" },
            { status: 409 },
          );
        this.set("baseline", snapshot);
        this.set("epoch", crypto.randomUUID());
        this.set("summary", body.summary);
        this.set("mode", "collector");
        return Response.json({ mode: "collector" });
      });
    }
    if (path === "/sync/status" && request.method === "GET") {
      const pending = this.sql
        .exec<{ count: number; oldest: number | null }>(
          "SELECT COUNT(*) AS count, MIN(collected_at) AS oldest FROM analytics_outbox",
        )
        .one();
      return Response.json({
        mode: this.mode(),
        epoch: this.get("epoch", null),
        sequence: this.get("sequence", 0),
        acknowledged: this.get("acknowledged", 0),
        seeded: this.get("seeded", false),
        pending: Number(pending.count),
        oldestPendingAt: pending.oldest,
        cachedAt: this.summary()?.generatedAt ?? null,
      });
    }
    if (path === "/sync/summary" && request.method === "GET") {
      if (this.mode() !== "authority")
        throw new AnalyticsSyncError("not-authority");
      return Response.json(this.hooks.summary());
    }
    if (path === "/sync/cache" && request.method === "POST") {
      if (this.mode() !== "collector")
        throw new AnalyticsSyncError("not-collector");
      this.cache((await request.json()) as AnalyticsSummary);
      return Response.json({ cached: true });
    }
    if (path === "/sync/baseline" && request.method === "GET") {
      if (this.mode() !== "collector")
        throw new AnalyticsSyncError("not-collector");
      return Response.json({
        epoch: this.get("epoch", ""),
        snapshot: this.get("baseline", null),
      });
    }
    if (path === "/sync/seed" && request.method === "POST") {
      if (this.mode() !== "authority")
        throw new AnalyticsSyncError("not-authority");
      const body = (await request.json()) as {
        epoch: string;
        snapshot: unknown;
      };
      if (
        typeof body?.epoch !== "string" ||
        !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.epoch)
      )
        throw new AnalyticsSyncError("invalid-epoch", 400);
      const hash = await digest(body.snapshot);
      return this.state.storage.transactionSync(() => {
        const peer = this.get<Peer | null>("peer", null);
        if (peer) {
          if (peer.epoch !== body.epoch || peer.baselineHash !== hash)
            throw new AnalyticsSyncError("baseline-mismatch");
          return this.receipt(body.epoch, 0, hash);
        }
        this.hooks.seed(
          body.snapshot,
          this.get("authorityDay", Math.floor(Date.now() / 86_400_000)),
        );
        this.set("peer", {
          epoch: body.epoch,
          head: 0,
          baselineHash: hash,
          lastAfter: 0,
          lastHash: "",
        });
        return this.receipt(body.epoch, 0, hash);
      });
    }
    if (path === "/sync/receive" && request.method === "POST") {
      if (this.mode() !== "authority")
        throw new AnalyticsSyncError("not-authority");
      const batch = (await request.json()) as AnalyticsBatch;
      if (
        !batch ||
        !Number.isSafeInteger(batch.after) ||
        batch.after < 0 ||
        !Array.isArray(batch.events) ||
        !batch.events.length ||
        batch.events.length > 100
      )
        throw new AnalyticsSyncError("invalid-batch", 400);
      const hash = await digest(batch);
      return this.state.storage.transactionSync(() => {
        const peer = this.get<Peer | null>("peer", null);
        if (!peer || peer.epoch !== batch.epoch)
          throw new AnalyticsSyncError("unknown-epoch");
        const through = batch.after + batch.events.length;
        if (!Number.isSafeInteger(through))
          throw new AnalyticsSyncError("invalid-batch", 400);
        if (peer.head !== batch.after) {
          if (
            peer.lastAfter === batch.after &&
            peer.head === through &&
            peer.lastHash === hash
          )
            return this.receipt(batch.epoch, through, hash);
          throw new AnalyticsSyncError("batch-mismatch");
        }
        const oldestDay = Math.max(
          Math.floor(Date.now() / 86_400_000) -
            (ANALYTICS_SYNC_RETENTION_DAYS - 1),
          this.get("authorityDay", 0),
        );
        for (const [index, event] of batch.events.entries()) {
          if (
            !event ||
            event.sequence !== batch.after + index + 1 ||
            !Number.isSafeInteger(event.collectedAt) ||
            event.collectedAt > Date.now() + 60_000
          )
            throw new AnalyticsSyncError("invalid-event", 400);
          if (Math.floor(event.collectedAt / 86_400_000) < oldestDay)
            throw new AnalyticsSyncError("event-outside-retention");
          this.hooks.apply(event);
        }
        this.set("peer", {
          ...peer,
          head: through,
          lastAfter: batch.after,
          lastHash: hash,
        });
        return this.receipt(batch.epoch, through, hash);
      });
    }
    if (path === "/sync/ack" && request.method === "POST") {
      if (this.mode() !== "collector")
        throw new AnalyticsSyncError("not-collector");
      const receipt = (await request.json()) as AnalyticsReceipt;
      if (
        receipt?.epoch === this.get("epoch", "") &&
        receipt.through === this.get("acknowledged", 0) &&
        receipt.hash === this.get("lastAckHash", null)
      )
        return Response.json({ acknowledged: receipt.through });
      const inflight = this.get<AnalyticsBatch | null>("inflight", null);
      const expectedHash = await digest(inflight ?? this.get("baseline", null));
      return this.state.storage.transactionSync(() => {
        if (
          receipt?.epoch === this.get("epoch", "") &&
          receipt.through === this.get("acknowledged", 0) &&
          receipt.hash === this.get("lastAckHash", null)
        )
          return Response.json({ acknowledged: receipt.through });
        if (
          JSON.stringify(this.get("inflight", null)) !==
          JSON.stringify(inflight)
        )
          throw new AnalyticsSyncError("receipt-mismatch");
        if (
          receipt?.epoch !== this.get("epoch", "") ||
          receipt.hash !== expectedHash ||
          receipt.through < this.get("acknowledged", 0) ||
          receipt.through !==
            (inflight ? inflight.after + inflight.events.length : 0) ||
          !validSummary(receipt.summary)
        )
          throw new AnalyticsSyncError("receipt-mismatch");
        this.sql.exec(
          "DELETE FROM analytics_outbox WHERE sequence<=?",
          receipt.through,
        );
        this.set("acknowledged", receipt.through);
        this.cache(receipt.summary);
        this.set("seeded", true);
        this.set("lastAckHash", receipt.hash);
        this.set("inflight", null);
        this.set("baseline", null);
        return Response.json({ acknowledged: receipt.through });
      });
    }
    if (path === "/sync/batch" && request.method === "GET") {
      if (this.mode() !== "collector")
        return Response.json({ error: "not-collector" }, { status: 409 });
      return this.state.storage.transactionSync(() => {
        const inflight = this.get<unknown>("inflight", null);
        if (inflight) return Response.json(inflight);
        const events: AnalyticsEvent[] = this.sql
          .exec<{
            sequence: number;
            kind: "hit" | "load";
            collected_at: number;
            payload: string;
          }>("SELECT * FROM analytics_outbox ORDER BY sequence LIMIT 100")
          .toArray()
          .map((row) => ({
            sequence: Number(row.sequence),
            kind: row.kind,
            collectedAt: Number(row.collected_at),
            payload: JSON.parse(row.payload),
          }));
        const batch = {
          epoch: this.get("epoch", ""),
          after: this.get("acknowledged", 0),
          events,
        };
        if (events.length) this.set("inflight", batch);
        return Response.json(batch);
      });
    }
    return Response.json({ error: "not-found" }, { status: 404 });
  }
}
