import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";
import { createGalleryTopologyTask } from "./gallery-topology-task";

const report = {
  scanned: 4,
  total: 4,
  comparable: 4,
  matches: [],
  uncheckable: 0,
  complete: true,
};
function harness() {
  const workers: {
    terminate: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: ((event: { data: typeof report }) => void) | null;
    onerror: (() => void) | null;
  }[] = [];
  const task = createGalleryTopologyTask(() => {
    const worker = {
      terminate: vi.fn(),
      postMessage: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { task, workers };
}

describe("background topology task", () => {
  it("keeps running with no mounted view and lets another view read completed results", () => {
    const { task, workers } = harness();
    const project = createEmptyProject("source", "Original snapshot");
    const unsubscribe = task.subscribe(vi.fn());
    task.start(project);
    unsubscribe();
    expect(workers[0]!.terminate).not.toHaveBeenCalled();
    expect(task.getSnapshot().running).toBe(true);
    workers[0]!.onmessage!({ data: report });
    expect(task.getSnapshot()).toMatchObject({
      running: false,
      report,
      snapshot: project,
    });
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  });
  it("retains the same independent source snapshot for matching and drawing after live edits", () => {
    const { task, workers } = harness();
    const project = createEmptyProject("source", "Original");
    task.start(project);
    const snapshot = task.getSnapshot().snapshot!;
    expect(snapshot).not.toBe(project);
    expect(workers[0]!.postMessage).toHaveBeenCalledWith({
      type: "topology",
      project: snapshot,
    });
    project.name = "Edited";
    project.documents[0]!.name = "Edited cell";
    workers[0]!.onmessage!({ data: report });
    expect(task.getSnapshot().snapshot).toBe(snapshot);
    expect(snapshot.name).toBe("Original");
    expect(snapshot.documents[0]!.name).not.toBe("Edited cell");
    expect(task.getSnapshot().sourceProject).toBe(project);
  });
  it("ignores late messages from cancelled or replaced workers", () => {
    const { task, workers } = harness();
    task.start(createEmptyProject("first", "First"));
    task.cancel();
    task.start(createEmptyProject("second", "Second"));
    workers[0]!.onmessage!({ data: report });
    expect(task.getSnapshot()).toMatchObject({ running: true, report: null });
    workers[1]!.onerror!();
    expect(task.getSnapshot()).toMatchObject({
      running: false,
      failure: expect.any(String),
    });
  });
});

describe("durable topology observation", () => {
  it("pauses observation without cancelling the server job and ignores detached responses", async () => {
    const { createDurableGalleryTopologyTask } =
      await import("./gallery-topology-task");
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
    let resolve!: (response: Response) => void;
    const requests: string[] = [];
    const task = createDurableGalleryTopologyTask(async (url, init) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (requests.length === 1)
        return new Promise<Response>((r) => {
          resolve = r;
        });
      return Response.json({ job: null });
    });
    try {
      const unsubscribe = task.subscribe(() => {});
      unsubscribe();
      resolve(
        Response.json({
          job: {
            id: "old",
            revision: 1,
            running: true,
            dismissed: false,
            report,
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(20000);
      expect(requests).toEqual(["GET /api/topology-task"]);
      expect(task.getSnapshot().running).toBe(false);
      const stop = task.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(requests).toEqual([
        "GET /api/topology-task",
        "GET /api/topology-task",
      ]);
      stop();
    } finally {
      task.dispose();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  it("stops unauthorized polling and rediscovers the current account on an account change", async () => {
    const { createDurableGalleryTopologyTask } =
      await import("./gallery-topology-task");
    const { ACCOUNT_CHANGED_EVENT } = await import("../../components/account");
    vi.useFakeTimers();
    const events = new EventTarget();
    vi.stubGlobal("window", events);
    let signedIn = false;
    const requests: string[] = [];
    const task = createDurableGalleryTopologyTask(async (url) => {
      requests.push(String(url));
      return signedIn
        ? Response.json({ job: null })
        : new Response(null, { status: 401 });
    });
    try {
      const unsubscribe = task.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(15000);
      expect(requests).toEqual(["/api/topology-task"]);
      signedIn = true;
      events.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
      await vi.advanceTimersByTimeAsync(0);
      expect(requests).toEqual(["/api/topology-task", "/api/topology-task"]);
      unsubscribe();
    } finally {
      task.dispose();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  it("forgets the previous account while observation is paused without cancelling its server job", async () => {
    const { createDurableGalleryTopologyTask } =
      await import("./gallery-topology-task");
    const { ACCOUNT_CHANGED_EVENT } = await import("../../components/account");
    const events = new EventTarget();
    vi.stubGlobal("window", events);
    vi.useFakeTimers();
    const requests: string[] = [];
    let account = "old";
    const task = createDurableGalleryTopologyTask(async (url, init) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      return Response.json({
        job:
          account === "old"
            ? {
                id: "old",
                revision: 1,
                running: false,
                dismissed: false,
                report,
              }
            : null,
      });
    });
    try {
      const stop = task.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(task.getSnapshot().report).toEqual(report);
      stop();
      account = "new";
      events.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
      expect(task.getSnapshot().report).toBeNull();
      await vi.advanceTimersByTimeAsync(20000);
      expect(requests).toHaveLength(1);
      task.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(requests).toEqual([
        "GET /api/topology-task",
        "GET /api/topology-task",
      ]);
    } finally {
      task.dispose();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  it("does not publish a previous account's delayed start response", async () => {
    const { createDurableGalleryTopologyTask } =
      await import("./gallery-topology-task");
    const { ACCOUNT_CHANGED_EVENT } = await import("../../components/account");
    const events = new EventTarget();
    vi.stubGlobal("window", events);
    vi.useFakeTimers();
    let deliver!: (value: unknown) => void;
    const task = createDurableGalleryTopologyTask(async (_url, init) =>
      init?.method === "POST"
        ? ({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: () =>
              new Promise((resolve) => {
                deliver = resolve;
              }),
          } as Response)
        : Response.json({ job: null }),
    );
    try {
      task.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(0);
      const starting = task.start(createEmptyProject("private", "Old account"));
      await vi.advanceTimersByTimeAsync(0);
      events.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
      deliver({
        job: {
          id: "old",
          revision: 1,
          running: true,
          dismissed: false,
          report,
        },
      });
      await starting;
      expect(task.getSnapshot()).toMatchObject({
        snapshot: null,
        sourceProject: null,
        report: null,
        running: false,
      });
    } finally {
      task.dispose();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  it("keeps the local fallback running without cloud observation on reopen or account changes", async () => {
    const { createDurableGalleryTopologyTask } =
      await import("./gallery-topology-task");
    const { ACCOUNT_CHANGED_EVENT } = await import("../../components/account");
    const events = new EventTarget();
    vi.stubGlobal("window", events);
    const local = harness();
    const requests: string[] = [];
    const task = createDurableGalleryTopologyTask(
      async (_url, init) => {
        requests.push(init?.method ?? "GET");
        return new Response(null, { status: 503 });
      },
      { localFallback: local.task },
    );
    try {
      const stop = task.subscribe(() => {});
      await task.start(createEmptyProject("local", "Local drawing"));
      const snapshot = task.getSnapshot();
      expect(snapshot.running).toBe(true);
      stop();
      task.subscribe(() => {});
      events.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
      expect(requests).toEqual(["GET", "POST"]);
      expect(task.getSnapshot()).toBe(snapshot);
      expect(local.workers[0]!.terminate).not.toHaveBeenCalled();
    } finally {
      task.dispose();
      local.task.cancel();
      vi.unstubAllGlobals();
    }
  });
  it("does not stop a new account's task when old POST recovery completes", async () => {
    const { createDurableGalleryTopologyTask } =
      await import("./gallery-topology-task");
    const { ACCOUNT_CHANGED_EVENT } = await import("../../components/account");
    vi.stubGlobal("window", new EventTarget());
    vi.useFakeTimers();
    let gets = 0;
    let posts = 0;
    let finishOld!: (response: Response) => void;
    let finishNew!: (response: Response) => void;
    const task = createDurableGalleryTopologyTask(async (_url, init) => {
      if (init?.method === "POST") {
        if (++posts === 1) throw new Error("Lost acknowledgement");
        return new Promise((resolve) => {
          finishNew = resolve;
        });
      }
      if (++gets === 2)
        return new Promise((resolve) => {
          finishOld = resolve;
        });
      return Response.json({ job: null });
    });
    try {
      task.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(0);
      const oldStart = task.start(createEmptyProject("old", "Old account"));
      await vi.advanceTimersByTimeAsync(0);
      window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
      await vi.advanceTimersByTimeAsync(0);
      const newStart = task.start(createEmptyProject("new", "New account"));
      finishOld(Response.json({ job: null }));
      await oldStart;
      expect(task.getSnapshot()).toMatchObject({
        snapshot: { name: "New account" },
        running: true,
      });
      finishNew(
        Response.json({
          job: {
            id: "new",
            revision: 1,
            running: true,
            dismissed: false,
            report,
          },
        }),
      );
      await newStart;
      expect(task.getSnapshot().running).toBe(true);
    } finally {
      task.dispose();
      finishNew?.(Response.json({ job: null }));
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  it("rediscovers the frozen server job after the page session is discarded", async () => {
    const { createDurableGalleryTopologyTask } =
      await import("./gallery-topology-task");
    const { serializeProject } = await import("@icm/project-protocol");
    const source = createEmptyProject("source", "Clicked snapshot");
    let server: Record<string, unknown> | null = null;
    let deletes = 0;
    const fetchLike: typeof fetch = async (_input, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        server = {
          id: body.id,
          revision: 1,
          projectText: body.projectText,
          running: true,
          dismissed: false,
          report: { ...report, complete: false, scanned: 1 },
        };
      }
      if (init?.method === "DELETE") deletes++;
      return Response.json({ job: server });
    };
    const first = createDurableGalleryTopologyTask(fetchLike);
    await first.start(source);
    source.name = "Edited after clicking";
    expect(first.getSnapshot().snapshot?.name).toBe("Clicked snapshot");
    first.dispose();
    expect(deletes).toBe(0);
    server = {
      id: "restored-job",
      dismissed: false,
      revision: 2,
      running: false,
      report,
      projectText: serializeProject(
        createEmptyProject("source", "Clicked snapshot"),
      ),
    };
    vi.stubGlobal("window", {});
    const reopened = createDurableGalleryTopologyTask(fetchLike);
    const unsubscribe = reopened.subscribe(vi.fn());
    await vi.waitFor(() =>
      expect(reopened.getSnapshot()).toMatchObject({
        running: false,
        snapshot: { name: "Clicked snapshot" },
        report,
      }),
    );
    unsubscribe();
    reopened.dispose();
    vi.unstubAllGlobals();
  });
});
