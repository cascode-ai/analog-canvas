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
