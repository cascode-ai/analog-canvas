import { parseProject, serializeProject } from "@icm/project-protocol";
import type { CircuitProject } from "@icm/model";
import type { GalleryTopologyMatchReport } from "../../gallery-topology-match";
import { ACCOUNT_CHANGED_EVENT } from "../../components/account";

export interface TopologyTaskState {
  durable?: boolean;
  snapshot: CircuitProject | null;
  sourceProject: CircuitProject | null;
  report: GalleryTopologyMatchReport | null;
  running: boolean;
  failure: string | null;
  noticeDismissed: boolean;
}

/** The task belongs to the page session, not to a disposable dialog. */
export function createGalleryTopologyTask(
  createWorker: () => Worker = () =>
    new Worker(new URL("../../gallery-duplicates.worker.ts", import.meta.url), {
      type: "module",
    }),
) {
  let worker: Worker | null = null;
  let state: TopologyTaskState = {
    snapshot: null,
    sourceProject: null,
    report: null,
    running: false,
    failure: null,
    noticeDismissed: false,
  };
  const listeners = new Set<() => void>();
  const update = (change: Partial<TopologyTaskState>) => {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  };
  const release = () => {
    worker?.terminate();
    worker = null;
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      // Closing a view only unsubscribes that view. It cannot cancel the task.
      return () => {
        listeners.delete(listener);
      };
    },
    cancel: () => {
      release();
      update({ running: false });
    },
    dismissNotice: () => update({ noticeDismissed: true }),
    start: (project: CircuitProject) => {
      release();
      const snapshot = structuredClone(project);
      update({
        snapshot,
        sourceProject: project,
        report: null,
        running: true,
        failure: null,
        noticeDismissed: false,
      });
      try {
        const next = createWorker();
        worker = next;
        next.onmessage = (event: MessageEvent<GalleryTopologyMatchReport>) => {
          if (worker !== next) return;
          const done = event.data.complete || !!event.data.error;
          if (done) release();
          update({ report: event.data, running: !done });
        };
        next.onerror = () => {
          if (worker !== next) return;
          release();
          update({
            running: false,
            failure: "Could not compare this Cell. Try again.",
          });
        };
        // Browser structured cloning captures all circuit data before the next edit.
        next.postMessage({ type: "topology", project: snapshot });
      } catch {
        release();
        update({
          running: false,
          failure: "Could not start topology matching. Try again.",
        });
      }
    },
  };
}

interface DurableJob {
  id: string;
  revision: number;
  running: boolean;
  dismissed: boolean;
  projectText?: string;
  report: GalleryTopologyMatchReport;
}

/** Polling is observation only: server alarms own execution and checkpoints. */
export function createDurableGalleryTopologyTask(
  fetchLike: typeof fetch = (...args) => fetch(...args),
  options: {
    localFallback?: ReturnType<typeof createGalleryTopologyTask>;
    pollMs?: number;
  } = {},
) {
  let state: TopologyTaskState = {
    snapshot: null,
    sourceProject: null,
    report: null,
    running: false,
    failure: null,
    noticeDismissed: false,
    durable: true,
  };
  let job: DurableJob | null = null;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watching = false;
  let observation = 0;
  let local = false;
  const listeners = new Set<() => void>();
  const update = (next: Partial<TopologyTaskState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };
  const endpoint = () =>
    job
      ? `/api/topology-task?id=${encodeURIComponent(job.id)}&revision=${job.revision}`
      : "/api/topology-task";
  const publish = (next: DurableJob | null) => {
    const changed = job?.id !== next?.id;
    job = next;
    if (!next) {
      update({ running: false });
      return;
    }
    update({
      ...(changed ? { sourceProject: null } : {}),
      ...(next.projectText ? { snapshot: parseProject(next.projectText) } : {}),
      report: next.report,
      running: next.running,
      noticeDismissed: next.dismissed,
      failure: null,
      durable: true,
    });
  };
  const later = () => {
    clearTimeout(timer);
    if (watching && !local && state.running)
      timer = setTimeout(() => void poll(), options.pollMs ?? 2000);
  };
  const poll = async () => {
    const current = generation;
    const observed = observation;
    try {
      const response = await fetchLike(endpoint(), {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (current !== generation || observed !== observation || local) return;
      if (response.status === 401 || response.status === 403) {
        clearTimeout(timer);
        job = null;
        update({
          snapshot: null,
          sourceProject: null,
          report: null,
          running: false,
          failure: null,
        });
        return;
      }
      if (!response.ok)
        throw new Error("Waiting to reconnect to the saved duplicate check…");
      const payload = (await response.json()) as {
        job?: DurableJob | null;
        unchanged?: boolean;
      };
      if (current !== generation || observed !== observation || local) return;
      if (!payload.unchanged && "job" in payload) publish(payload.job ?? null);
    } catch {
      if (current !== generation || observed !== observation || local) return;
      if (state.running)
        update({
          failure:
            "Connection interrupted. The server check continues; reconnecting…",
        });
      if (watching && (!options.localFallback || state.running)) {
        clearTimeout(timer);
        timer = setTimeout(() => void poll(), options.pollMs ?? 5000);
      }
      return;
    }
    if (current === generation && observed === observation) later();
  };
  const accountChanged = () => {
    if (local) return;
    generation++;
    observation++;
    clearTimeout(timer);
    job = null;
    update({
      snapshot: null,
      sourceProject: null,
      report: null,
      running: false,
      failure: null,
      noticeDismissed: false,
    });
    if (watching && !local) void poll();
  };
  const stopWatching = () => {
    watching = false;
    observation++;
    clearTimeout(timer);
  };
  const unsubscribeFallback = options.localFallback?.subscribe(() => {
    if (local)
      update({ ...options.localFallback!.getSnapshot(), durable: false });
  });
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!watching && typeof window !== "undefined") {
        watching = true;
        window.addEventListener?.(ACCOUNT_CHANGED_EVENT, accountChanged);
        if (!local) void poll();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) stopWatching();
      };
    },
    async start(project: CircuitProject) {
      generation++;
      const current = generation;
      clearTimeout(timer);
      if (local) {
        options.localFallback!.start(project);
        return;
      }
      const snapshot = structuredClone(project);
      update({
        snapshot,
        sourceProject: project,
        report: null,
        running: true,
        failure: null,
        noticeDismissed: false,
      });
      const id = crypto.randomUUID();
      try {
        const response = await fetchLike("/api/topology-task", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, projectText: serializeProject(snapshot) }),
        });
        if (current !== generation) return;
        // Vite-only installations have no cloud backend. Keep that limitation explicit.
        if (
          options.localFallback &&
          (response.status === 503 ||
            response.status === 404 ||
            response.headers.get("content-type")?.includes("text/html"))
        ) {
          local = true;
          options.localFallback.start(project);
          return;
        }
        if (response.status === 409) {
          job = null;
          await poll();
          return;
        }
        if (response.status === 401)
          throw new Error("Sign in to check for similar Gallery circuits.");
        const payload = (await response.json()) as {
          job?: DurableJob;
          error?: string;
        };
        if (current !== generation) return;
        if (!response.ok || !payload.job)
          throw new Error(payload.error ?? "Could not start the server check.");
        publish(payload.job);
        // Keep the in-memory frozen snapshot, even if the caller edits the live Project.
        update({ snapshot, sourceProject: project });
        later();
      } catch (error) {
        if (current !== generation) return;
        // A lost POST acknowledgement may still have created the durable job.
        job = null;
        update({
          failure:
            error instanceof Error
              ? error.message
              : "Could not start duplicate check.",
        });
        await poll();
        if (current !== generation) return;
        if (!job) update({ running: false });
      }
    },
    async cancel() {
      if (local) {
        options.localFallback!.cancel();
        return;
      }
      if (!job) return;
      const current = generation;
      try {
        const response = await fetchLike(
          `/api/topology-task?id=${encodeURIComponent(job.id)}`,
          { method: "DELETE", credentials: "same-origin" },
        );
        if (!response.ok)
          throw new Error(
            "Could not cancel the server check. It is still running.",
          );
        const payload = await response.json();
        if (current !== generation) return;
        generation++;
        clearTimeout(timer);
        publish(payload.job);
      } catch (error) {
        if (current !== generation) return;
        update({ failure: String(error) });
      }
    },
    dismissNotice() {
      if (local) {
        options.localFallback!.dismissNotice();
        return;
      }
      update({ noticeDismissed: true });
      if (job)
        void fetchLike(`/api/topology-task?id=${encodeURIComponent(job.id)}`, {
          method: "PATCH",
          credentials: "same-origin",
        }).catch(() => {});
    },
    /** Test/lifecycle cleanup does not cancel cloud work. */
    dispose() {
      generation++;
      stopWatching();
      if (typeof window !== "undefined")
        window.removeEventListener?.(ACCOUNT_CHANGED_EVENT, accountChanged);
      unsubscribeFallback?.();
      listeners.clear();
    },
  };
}

let task: ReturnType<typeof createDurableGalleryTopologyTask> | undefined;
/** Only a mounted community surface asks for the page-owned task. */
export function getGalleryTopologyTask() {
  return (task ??= createDurableGalleryTopologyTask(
    undefined,
    import.meta.env.DEV ? { localFallback: createGalleryTopologyTask() } : {},
  ));
}
