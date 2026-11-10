// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import {
  GalleryDownloadButton,
  GalleryDownloadView,
  type GalleryDownloadRun,
} from "./gallery-download-button";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => vi.unstubAllGlobals());

const job = { query: { source: "circuitthink" }, key: "source=circuitthink" };
const view = (
  run: GalleryDownloadRun,
  count: number | null = 78,
  pending = false,
) =>
  renderToStaticMarkup(
    createElement(GalleryDownloadView, {
      count,
      pending,
      run,
      onStart: () => undefined,
      onCancel: () => undefined,
      onRetry: () => undefined,
    }),
  );

it("is one button labelled with the wall's own count, never a menu", () => {
  const idle = view({ kind: "idle" });
  expect(idle).toMatch(/<button[^>]*data-testid="gallery-download-button"/u);
  expect(idle).toContain("Download</span>");
  expect(idle).toContain(">78</span>");
  expect(idle).toContain('aria-label="Download 78 circuits as a .zip"');
  expect(idle).not.toMatch(/<button[^>]*disabled/u);
  expect(idle).not.toMatch(/<details|These results|Everything/u);
  // The whole Gallery's count, grouped.
  expect(view({ kind: "idle" }, 5016)).toContain(">5,016</span>");
  // Nothing to save, or a count still on its way: no press.
  expect(view({ kind: "idle" }, 0)).toMatch(/<button[^>]*disabled/u);
  expect(view({ kind: "idle" }, null)).toMatch(/<button[^>]*disabled/u);
  const counting = view({ kind: "idle" }, 78, true);
  expect(counting).toMatch(/<button[^>]*aria-busy="true"[^>]*disabled/u);
});

it("shows a run's progress in the button's place, with Cancel beside it", () => {
  const running = view({
    kind: "running",
    job,
    total: 78,
    progress: { phase: "reading", listed: 78, done: 32, failed: 0 },
    controller: new AbortController(),
  });
  expect(running).toContain(">32 / 78</span>");
  expect(running).not.toContain("Download</span>");
  expect(running).toContain('data-testid="gallery-download-cancel"');
  // Still listing: none read yet of what was counted.
  expect(
    view({
      kind: "running",
      job,
      total: 78,
      progress: { phase: "listing", listed: 60, done: 0, failed: 0 },
      controller: new AbortController(),
    }),
  ).toContain(">0 / 78</span>");
});

it("never calls a partial archive complete, and offers Retry", () => {
  const partial = view({
    kind: "done",
    job,
    url: "blob:zip",
    fileName: "analog-canvas-gallery-circuitthink-2026-11-10.zip",
    count: 75,
    failed: [
      { id: "ct-1", name: "A", reason: "404 not-found" },
      { id: "ct-2", name: "B", reason: "network error" },
      { id: "ct-3", name: "C", reason: "network error" },
    ],
  });
  expect(partial).toContain(">Download ZIP</a>");
  expect(partial).toContain(">3 failed</span>");
  expect(partial).toContain('title="Not saved: ct-1, ct-2, ct-3"');
  expect(partial).toContain('data-testid="gallery-download-retry"');
  const failed = view({
    kind: "error",
    job,
    message: "Could not list the circuits (503).",
  });
  expect(failed).toContain(">Failed</span>");
  expect(failed).toContain('title="Could not list the circuits (503)."');
  expect(failed).toContain('data-testid="gallery-download-retry"');
});

it("stays out of sight off the community wall while nothing runs", () => {
  expect(
    renderToStaticMarkup(
      createElement(GalleryDownloadButton, {
        query: {},
        count: 12,
        pending: false,
        hidden: true,
      }),
    ),
  ).toBe("");
});

it("saves the query fixed at the press, then counts the current wall again (#2173)", async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      requests.push(input);
      if (input.startsWith("/api/gallery?"))
        return Response.json({
          entries: [
            { id: "ct-1", name: "Mirror", author: "CircuitThink", tags: [] },
            { id: "ct-2", name: "Bandgap", author: "CircuitThink", tags: [] },
          ],
          nextCursor: null,
          total: 2,
        });
      if (input === "/api/gallery/ct-1?download=1")
        return Response.json({
          entry: { id: "ct-1", name: "Mirror" },
          projectText: '{"format":"icproj"}',
        });
      return Response.json({ error: "not-found" }, { status: 404 });
    }),
  );
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: () => "blob:zip",
      revokeObjectURL: () => undefined,
    }),
  );
  const saved: string[] = [];
  const save = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  const render = (query: { source?: string; q?: string }, count: number) =>
    act(async () =>
      root.render(
        createElement(GalleryDownloadButton, { query, count, pending: false }),
      ),
    );
  const button = () =>
    host.querySelector<HTMLButtonElement>(
      '[data-testid="gallery-download-button"]',
    )!;
  await render({ source: "circuitthink" }, 2);
  expect(button().textContent).toBe("Download2");
  await act(async () => button().click());
  await vi.waitFor(
    () =>
      expect(
        host.querySelector('[data-testid="gallery-download-failed"]')
          ?.textContent,
      ).toBe("1 failed"),
    { timeout: 5000 },
  );
  expect(requests[0]).toBe(
    "/api/gallery?source=circuitthink&order=oldest&limit=60",
  );
  // The archive holds what could be read and saves itself at once.
  expect(saved).toEqual([
    expect.stringMatching(/^analog-canvas-gallery-circuitthink-.*\.zip$/u),
  ]);
  expect(host.textContent).toContain("Download ZIP");
  expect(button().textContent).toBe("Download2");
  // Other filters: the button counts them, and the old run says nothing.
  await render({ source: "circuitthink", q: "zzzz" }, 0);
  expect(button().textContent).toBe("Download0");
  expect(button().disabled).toBe(true);
  expect(host.textContent).not.toMatch(/failed|Download ZIP/u);
  await render({ source: "circuitthink" }, 2);
  expect(button().disabled).toBe(false);
  expect(host.textContent).not.toMatch(/failed|Download ZIP/u);
  await act(async () => root.unmount());
  host.remove();
  save.mockRestore();
});
