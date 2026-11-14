import { afterAll, afterEach, expect, it, vi } from "vitest";

import {
  followReviewDrawing,
  type ReviewDrawingChange,
} from "./review-drawing-refresh";

// Another tab of this browser, as the editor's publication speaks to Review.
const editorTab = new BroadcastChannel("analog-canvas-gallery-change-v1");
const published = (entryId: string, previewRevision?: string) =>
  editorTab.postMessage({
    type: "gallery-changed",
    sourceId: "editor-tab",
    entryId,
    ...(previewRevision ? { previewRevision } : {}),
  });

/** The Gallery's entry summary, as the Worker answers it. */
function gallery(entry: { previewRevision: string; fixedBy?: string[] }) {
  const asked: string[] = [];
  const fetchLike = (async (url: string) => {
    asked.push(url);
    return Response.json({ entry });
  }) as unknown as typeof fetch;
  return { asked, fetchLike, entry };
}

const stops: (() => void)[] = [];
afterAll(() => editorTab.close());
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.unstubAllGlobals();
});

function follow(
  revision: string,
  fetchLike: typeof fetch,
  entryId = "ag-1755",
) {
  const changes: ReviewDrawingChange[] = [];
  let current = revision;
  stops.push(
    followReviewDrawing(
      entryId,
      () => current,
      (change) => {
        changes.push(change);
        current = change.previewRevision;
      },
      fetchLike,
    ),
  );
  return changes;
}

it("shows a drawing published from the editor beside Review at once (#2304)", async () => {
  // The read races the publication and still answers the old drawing.
  const server = gallery({ previewRevision: "r1" });
  const changes = follow("r1", server.fetchLike);
  published("another-entry", "x9");
  published("ag-1755", "r2");
  await vi.waitFor(() => expect(server.asked).toHaveLength(1));
  await vi.waitFor(() => expect(changes).toEqual([{ previewRevision: "r2" }]));
  expect(server.asked).toEqual(["/api/gallery/ag-1755?summary=1"]);

  // Once the entry reads back, who fixed it joins the new drawing.
  server.entry.previewRevision = "r2";
  server.entry.fixedBy = ["Reviewer"];
  published("ag-1755", "r2");
  await vi.waitFor(() =>
    expect(changes).toEqual([
      { previewRevision: "r2" },
      { previewRevision: "r2", fixedBy: ["Reviewer"] },
    ]),
  );
});

it("reads the entry again when Review becomes the active view", async () => {
  const focus = new EventTarget();
  vi.stubGlobal("window", focus);
  const server = gallery({ previewRevision: "r3", fixedBy: ["Reviewer"] });
  const changes = follow("r1", server.fetchLike);
  focus.dispatchEvent(new Event("focus"));
  await vi.waitFor(() =>
    expect(changes).toEqual([{ previewRevision: "r3", fixedBy: ["Reviewer"] }]),
  );
  // Nothing new: nothing changes.
  focus.dispatchEvent(new Event("focus"));
  await vi.waitFor(() => expect(server.asked).toHaveLength(2));
  expect(changes).toHaveLength(1);
});
