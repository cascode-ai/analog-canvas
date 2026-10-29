// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UserComponentsLibrary from "./user-components-library";
import type { ComponentLibrarySummaryPage } from "./component-library-contract";

function page(
  names: string[],
  nextCursor: string | null = null,
  catalogRevision = 1,
): ComponentLibrarySummaryPage {
  return {
    entries: names.map((name, index) => ({
      id: name.startsWith("large")
        ? `large-entry-${index}`
        : `component-${name}`,
      name,
      revision: 1,
      authorId: "alice",
      author: "Alice",
      status: "shared",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      capability: "symbol-only",
      pinCount: 0,
      parameterCount: 0,
    })),
    nextCursor,
    catalogRevision,
  };
}
let root: Root;
let container: HTMLDivElement;
let summaries: (url: URL) => Promise<Response>;
let detail: () => Promise<Response>;
let reads: URL[];
const props = {
  onClose: () => {},
  onCreate: () => {},
  onEdit: () => {},
  onInsert: () => {},
};
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "showPopover", {
    configurable: true,
    value() {},
  });
  Object.defineProperty(HTMLElement.prototype, "hidePopover", {
    configurable: true,
    value() {},
  });
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Layout/preview intersection remains a browser obligation.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/auth/me") return Response.json({ user: null });
      if (url.pathname === "/api/components") {
        reads.push(url);
        return summaries(url);
      }
      return detail();
    }),
  );
  reads = [];
  summaries = async () => Response.json(page(["old"]));
  detail = async () => Response.json({ error: "changed" }, { status: 409 });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
  delete (HTMLElement.prototype as Partial<HTMLElement>).hidePopover;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render(open = true, refresh = 0) {
  await act(async () =>
    root.render(
      <UserComponentsLibrary {...props} open={open} refresh={refresh} />,
    ),
  );
  await tick();
}
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
}
function tiles() {
  return container.querySelectorAll(".user-component-tile");
}
function button(name: string) {
  const found = [...container.querySelectorAll("button")].find(
    (element) =>
      (element.getAttribute("aria-label") ?? element.textContent?.trim()) ===
      name,
  );
  expect(found, name).toBeDefined();
  return found!;
}
async function click(name: string) {
  await act(async () => button(name).click());
  await tick();
}
async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search User Defined components"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await tick();
}

describe("User Components catalog wiring", () => {
  it.each(["reopening", "selection conflict"])(
    "resumes a buffered generation after %s without replacing visible cards early",
    async (trigger) => {
      await render();
      let fail = true;
      summaries = async (url) => {
        if (url.searchParams.has("cursor")) {
          if (fail) return Response.json({ error: "offline" }, { status: 503 });
          return Response.json(page(["last"], null, 2));
        }
        return Response.json(page(["new"], "tail", 2));
      };
      if (trigger === "reopening") {
        await render(false);
        await render();
      } else {
        await click("Actions for old");
        await click("Details for old");
      }
      expect(tiles()).toHaveLength(1);
      expect(button("Place old")).toBeDefined();
      expect(container.querySelector('[aria-label="Place new"]')).toBeNull();
      expect(container.textContent).toContain("Couldn’t refresh components.");
      fail = false;
      await click("Try Again");
      expect(tiles()).toHaveLength(2);
      expect(button("Place new")).toBeDefined();
      expect(button("Place last")).toBeDefined();
      expect(reads.map((url) => url.searchParams.get("cursor"))).toEqual([
        null,
        null,
        "tail",
        "tail",
      ]);
      expect(container.textContent).not.toContain("Try Again");
    },
  );
  it("resumes the retained page even when it exceeds the session cache byte limit", async () => {
    const large = page(
      Array.from({ length: 60 }, (_, i) => `large ${i} ${"x".repeat(18_000)}`),
      "tail",
    );
    let fail = true;
    summaries = async (url) => {
      if (!url.searchParams.has("cursor")) return Response.json(large);
      return fail
        ? Response.json({ error: "offline" }, { status: 503 })
        : Response.json(page(["last"]));
    };
    await render();
    expect(tiles()).toHaveLength(60);
    fail = false;
    await click("Try Again");
    expect(tiles()).toHaveLength(61);
    expect(reads.map((url) => url.searchParams.get("cursor"))).toEqual([
      null,
      "tail",
      "tail",
    ]);
  });
  it("retains cached cards on failed reopening and distinguishes a new failed query", async () => {
    await render();
    expect(tiles(), container.textContent ?? "").toHaveLength(1);
    await render(false);
    vi.setSystemTime(Date.now() + 120_000);
    summaries = async () => {
      throw new Error("offline");
    };
    await render();
    expect(tiles()).toHaveLength(1);
    expect(container.textContent).toContain("Couldn’t refresh components.");
    await search("unmatched");
    expect(tiles()).toHaveLength(0);
    expect(container.textContent).toContain("Couldn’t load user components.");
    await search("");
    expect(tiles()).toHaveLength(1);
    expect(container.textContent).toContain("Couldn’t refresh components.");
  });
});
