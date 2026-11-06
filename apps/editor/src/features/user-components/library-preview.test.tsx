// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { builtInSymbols } from "@icm/symbols";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import { LibraryPreview } from "./library-preview";

const symbol = builtInSymbols.find((item) => item.id === "resistor")!;
const summary = (id: string): ComponentLibrarySummary => ({
  id,
  revision: 1,
  authorId: "alice",
  author: "Alice",
  status: "shared",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  name: id,
  capability: "symbol-only",
  pinCount: 2,
  parameterCount: 0,
});

let root: Root;
let container: HTMLDivElement;
let reads: URL[];
let answer: (url: URL) => Response;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: Promise.resolve(),
      addEventListener() {},
      removeEventListener() {},
    },
  });
  // Every row is in view as soon as it is observed.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe() {
        this.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      disconnect() {}
    },
  );
  reads = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      reads.push(url);
      return answer(url);
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(document, "fonts");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function show(ids: string[]) {
  await act(async () =>
    root.render(
      <>
        {ids.map((id) => (
          <LibraryPreview key={id} entry={summary(id)} />
        ))}
      </>,
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
}

describe("LibraryPreview", () => {
  it("reads the previews of rows that come into view together in one request", async () => {
    answer = (url) =>
      Response.json({
        previews: url.searchParams
          .get("ids")!
          .split(",")
          .map((key) => {
            const [id, revision] = key.split(":");
            return { id, revision: Number(revision), symbol };
          }),
      });
    await show(["batch-one-01", "batch-two-02", "batch-three-03"]);
    expect(reads).toHaveLength(1);
    expect(reads[0]!.searchParams.get("view")).toBe("previews");
    expect(reads[0]!.searchParams.get("ids")).toBe(
      "batch-one-01:1,batch-two-02:1,batch-three-03:1",
    );
    expect(container.querySelectorAll("svg")).toHaveLength(3);
  });

  it("falls back to one read per record when the service predates batched previews", async () => {
    answer = (url) =>
      url.searchParams.get("view") === "previews"
        ? Response.json({ entries: [], nextCursor: null })
        : Response.json({
            id: url.pathname.split("/").at(-1),
            revision: 1,
            symbol,
          });
    await show(["older-one-01", "older-two-02"]);
    expect(reads.map((url) => url.searchParams.get("view"))).toEqual([
      "previews",
      "preview",
      "preview",
    ]);
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });

  it("shows a record the batch could not read as unavailable, without a second request", async () => {
    answer = () => Response.json({ previews: [] });
    await show(["changed-record-01"]);
    expect(reads).toHaveLength(1);
    expect(container.textContent).toContain("Preview unavailable");
  });
});
