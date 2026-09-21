import {
  projectElectricalGraph,
  compareTopologyCorrespondence,
} from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import type { GalleryFeedEntry } from "../apps/editor/src/gallery-client";
import type { GalleryTopologyMatchReport } from "../apps/editor/src/gallery-topology-match";
import { sessionUserOf } from "./auth";
import type { GalleryEnv, GalleryNamespaceLike } from "./gallery-do";

export type TopologyTaskEnv = GalleryEnv & {
  TOPOLOGY_TASK?: GalleryNamespaceLike;
};
type TaskState = {
  storage: {
    sql: { exec<T>(query: string, ...values: unknown[]): { toArray(): T[] } };
    transactionSync<T>(action: () => T): T;
    setAlarm(time: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
};
interface Job {
  id: string;
  createdAt: number;
  expiresAt: number;
  revision: number;
  running: boolean;
  dismissed: boolean;
  projectText: string;
  ids: string[] | null;
  failures: number;
  report: GalleryTopologyMatchReport;
}
const RETENTION = 7 * 24 * 60 * 60_000;
const COOKIE = "icm_topology_session";
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const RESULT_BYTES = 8 * 1024 * 1024;
const RESULT_LIMIT = 20;

/** One private account (or anonymous browser) owns one durable snapshot job.
 * Alarms, not client polling, drive work. Every completed candidate checkpoints. */
export class TopologyTaskDO {
  constructor(
    private state: TaskState,
    private env: Pick<GalleryEnv, "GALLERY">,
    private now = Date.now,
  ) {
    state.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS topology_job (part INTEGER PRIMARY KEY, text TEXT NOT NULL)",
    );
  }
  private read(): Job | null {
    const rows = this.state.storage.sql
      .exec<{ text: string }>("SELECT text FROM topology_job ORDER BY part")
      .toArray();
    return rows.length
      ? (JSON.parse(rows.map((row) => row.text).join("")) as Job)
      : null;
  }
  private write(job: Job) {
    job.revision++;
    const text = JSON.stringify(job);
    // Split large snapshots below SQLite's row-size limit; one transaction
    // swaps the entire checkpoint, never a partial Project or result list.
    this.state.storage.transactionSync(() => {
      this.state.storage.sql.exec("DELETE FROM topology_job");
      for (let offset = 0; offset < text.length;) {
        let end = Math.min(text.length, offset + 128_000);
        const last = text.charCodeAt(end - 1);
        if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
        this.state.storage.sql.exec(
          "INSERT INTO topology_job(part, text) VALUES (?, ?)",
          offset,
          text.slice(offset, end),
        );
        offset = end;
      }
    });
  }
  private async gallery(operation: string, body: unknown) {
    return this.env.GALLERY.getByName("gallery").fetch(
      `https://gallery/${operation}`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }
  private response(job: Job | null, url: URL): Response {
    if (!job) return Response.json({ job: null });
    if (
      url.searchParams.get("revision") === String(job.revision) &&
      url.searchParams.get("id") === job.id
    )
      return Response.json({ unchanged: true });
    return Response.json({
      job: {
        id: job.id,
        revision: job.revision,
        running: job.running,
        dismissed: job.dismissed,
        expiresAt: job.expiresAt,
        report: job.report,
        ...(url.searchParams.get("id") === job.id
          ? {}
          : { projectText: job.projectText }),
      },
    });
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let job = this.read();
    if (job && job.expiresAt <= this.now()) {
      this.state.storage.sql.exec("DELETE FROM topology_job");
      job = null;
    }
    if (request.method === "GET") return this.response(job, url);
    if (request.method === "DELETE" || request.method === "PATCH") {
      if (!job || url.searchParams.get("id") !== job.id)
        return Response.json({ error: "job-changed" }, { status: 409 });
      if (request.method === "DELETE") {
        job.running = false;
        await this.state.storage.setAlarm(job.expiresAt);
      } else job.dismissed = true;
      this.write(job);
      return this.response(job, url);
    }
    if (request.method !== "POST")
      return Response.json({ error: "method-not-allowed" }, { status: 405 });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_SOURCE_BYTES + 16_384)
      return Response.json({ error: "source-too-large" }, { status: 413 });
    let body: { id?: string; projectText?: string };
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: "invalid-request" }, { status: 400 });
    }
    if (
      !body ||
      !/^[a-zA-Z0-9-]{8,80}$/.test(body.id ?? "") ||
      typeof body.projectText !== "string" ||
      new TextEncoder().encode(body.projectText).length > MAX_SOURCE_BYTES
    )
      return Response.json({ error: "invalid-source" }, { status: 400 });
    if (job?.id === body.id) return this.response(job, url); // lost acknowledgement
    if (job?.running)
      return Response.json({ error: "already-running" }, { status: 409 });
    if (job && this.now() - job.createdAt < 30_000)
      return Response.json(
        { error: "Please wait 30 seconds before starting another check." },
        { status: 429 },
      );
    let source;
    try {
      source = projectElectricalGraph(parseProject(body.projectText));
    } catch {
      return Response.json({ error: "invalid-project" }, { status: 400 });
    }
    const report: GalleryTopologyMatchReport = {
      scanned: 0,
      total: null,
      comparable: 0,
      matches: [],
      uncheckable: 0,
      complete: false,
      exactMatches: 0,
      limitedComparisons: 0,
      omittedMatches: 0,
    };
    if (source.status !== "ready" || source.graph.labels.length > 5000) {
      report.sourceError =
        source.status !== "ready"
          ? source.reason
          : "This circuit exceeds the background comparison size limit (5,000 graph vertices). Compare one Cell at a time.";
      report.complete = true;
    }
    job = {
      id: body.id!,
      createdAt: this.now(),
      expiresAt: this.now() + RETENTION,
      revision: 0,
      running: !report.complete,
      dismissed: false,
      projectText: body.projectText,
      ids: null,
      failures: 0,
      report,
    };
    await this.state.storage.setAlarm(
      job.running ? this.now() + 100 : job.expiresAt,
    );
    this.write(job);
    return this.response(job, url);
  }
  async alarm(): Promise<void> {
    const job = this.read();
    if (!job) return;
    if (job.expiresAt <= this.now()) {
      this.state.storage.sql.exec("DELETE FROM topology_job");
      return;
    }
    if (!job.running) {
      await this.state.storage.setAlarm(job.expiresAt);
      return;
    }
    // Install a retry before external reads. Worker eviction cannot lose the job.
    await this.state.storage.setAlarm(this.now() + 5_000);
    try {
      if (job.ids === null) {
        const response = await this.gallery("topology-inventory", {});
        if (!response.ok)
          throw new Error("Gallery inventory is temporarily unavailable");
        job.ids = ((await response.json()) as { ids: string[] }).ids;
        job.report.total = job.ids.length;
        this.write(job);
      }
      const source = projectElectricalGraph(parseProject(job.projectText));
      if (source.status !== "ready") throw new Error(source.reason);
      for (
        let step = 0;
        step < 3 && job.report.scanned < job.ids.length;
        step++
      ) {
        const id = job.ids[job.report.scanned]!;
        const response = await this.gallery("entry", { id });
        // Cancellation/replacement can land while awaiting a Gallery read.
        const current = this.read();
        if (!current || current.id !== job.id || !current.running) return;
        job.dismissed = current.dismissed;
        if (response.status >= 500 || response.status === 429)
          throw new Error("Gallery temporarily unavailable; scan will retry");
        try {
          if (!response.ok) throw new Error("No longer public");
          const detail = (await response.json()) as {
            entry: GalleryFeedEntry;
            projectText: string;
            status: string;
          };
          if (detail.status !== "public") throw new Error("No longer public");
          const project = parseProject(detail.projectText);
          const candidate = projectElectricalGraph(project);
          if (
            candidate.status !== "ready" ||
            candidate.graph.labels.length > 5000
          )
            throw new Error("Candidate exceeds comparison limits");
          const comparison = compareTopologyCorrespondence(
            source.graph,
            candidate.graph,
            200_000,
          );
          job.report.comparable++;
          if (comparison.exact)
            job.report.exactMatches = (job.report.exactMatches ?? 0) + 1;
          if (comparison.limited)
            job.report.limitedComparisons =
              (job.report.limitedComparisons ?? 0) + 1;
          const ranked = [
            ...job.report.matches,
            {
              ...comparison,
              entry: {
                id: detail.entry.id,
                name: detail.entry.name,
                author: detail.entry.author,
                description: detail.entry.description,
                createdAt: detail.entry.createdAt,
                schemaVersion: detail.entry.schemaVersion,
              },
              candidate: { ...project, simulationFolders: [] },
            },
          ].sort(
            (a, b) =>
              b.similarity - a.similarity ||
              Number(b.exact) - Number(a.exact) ||
              a.entry.id.localeCompare(b.entry.id),
          );
          let bytes = 0;
          job.report.matches = ranked.filter((match, index) => {
            bytes += new TextEncoder().encode(JSON.stringify(match)).length;
            return index < RESULT_LIMIT && bytes <= RESULT_BYTES;
          });
          job.report.omittedMatches =
            job.report.comparable - job.report.matches.length;
        } catch {
          job.report.uncheckable++;
        }
        job.report.scanned++;
        job.failures = 0;
        if (job.report.scanned === job.ids.length) {
          job.report.complete = true;
          job.running = false;
        }
        this.write(job);
      }
      if (!job.ids.length) {
        job.report.complete = true;
        job.running = false;
        this.write(job);
      }
      await this.state.storage.setAlarm(
        job.running ? this.now() + 100 : job.expiresAt,
      );
    } catch (error) {
      const current = this.read();
      if (!current || current.id !== job.id || !current.running) return;
      current.failures++;
      if (current.failures >= 5) {
        current.running = false;
        current.report.error =
          error instanceof Error
            ? error.message
            : "Could not finish comparison. Try again.";
      }
      this.write(current);
      await this.state.storage.setAlarm(
        current.running
          ? this.now() + Math.min(60_000, 2 ** current.failures * 1_000)
          : current.expiresAt,
      );
    }
  }
}

/** Source drawings never enter Gallery. Account ids or HttpOnly anonymous
 * capabilities select the private object; arbitrary client job ids grant no access. */
export async function routeTopologyTaskRequest(
  request: Request,
  env: TopologyTaskEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/topology-task") return null;
  if (!env.TOPOLOGY_TASK)
    return Response.json(
      { error: "durable-topology-unavailable" },
      { status: 503 },
    );
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method))
    return new Response(null, { status: 405 });
  if (request.method !== "GET" && request.headers.get("origin") !== url.origin)
    return Response.json({ error: "forbidden" }, { status: 403 });
  const user = await sessionUserOf(request, env);
  let anonymous = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!/^[a-f0-9-]{36}$/.test(anonymous ?? "")) anonymous = undefined;
  let setCookie: string | undefined;
  if (!user && !anonymous) {
    if (request.method !== "POST")
      return Response.json(
        { job: null },
        { headers: { "cache-control": "private, no-store" } },
      );
    anonymous = crypto.randomUUID();
    setCookie = `${COOKIE}=${anonymous}; Path=/api/topology-task; HttpOnly; Secure; SameSite=Strict; Max-Age=${RETENTION / 1000}`;
  }
  const owner = user ? `user:${user.id}` : `browser:${anonymous}`;
  const response = await env.TOPOLOGY_TASK.getByName(owner).fetch(
    `https://topology/job${url.search}`,
    {
      method: request.method,
      ...(request.method === "POST" ? { body: await request.text() } : {}),
    },
  );
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(response.body, { status: response.status, headers });
}
