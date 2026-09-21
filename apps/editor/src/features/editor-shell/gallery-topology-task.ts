import type { CircuitProject } from "@icm/model";
import type { GalleryTopologyMatchReport } from "../../gallery-topology-match";

export interface TopologyTaskState {
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

export const galleryTopologyTask = createGalleryTopologyTask();
