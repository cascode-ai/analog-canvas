// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OwnerDataContent, type OwnerDataAuthor } from "./owner-data";

const author = (transistors: number): OwnerDataAuthor => ({
  author: "Maker",
  key: "maker-id",
  circuits: 3,
  components: 30,
  transistors,
  transistorsPending: 0,
  ai: 0,
  withNetlist: 3,
  likes: 0,
  opens: 0,
  latest: "2026-11-05T10:00:00.000Z",
});

let root: Root;
let container: HTMLDivElement;
let recounts: unknown[];

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  recounts = [];
  const batches = [
    { counted: 2, remaining: 1, next: "b" },
    { counted: 1, remaining: 0, next: null },
  ];
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/gallery/owner-data/recount") {
        recounts.push(JSON.parse(String(init?.body)));
        return Response.json(batches.shift());
      }
      reads += 1;
      return Response.json({ authors: [author(reads === 1 ? 5 : 12)] });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => {});

describe("the Owner's Data tab", () => {
  it("recounts every circuit in batches and shows the new totals", async () => {
    act(() => root.render(<OwnerDataContent />));
    await settle();
    const totals = () =>
      container.querySelector('[data-testid="owner-data-totals"]')!.textContent;
    expect(totals()).toContain("5 transistors");
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="owner-data-recount"]',
    )!;
    act(() => button.click());
    await settle();
    await settle();
    // Each batch resumes where the last one stopped.
    expect(recounts).toEqual([{ after: "" }, { after: "b" }]);
    expect(
      container.querySelector('[data-testid="owner-data-recount-status"]')!
        .textContent,
    ).toBe("3 circuits recounted");
    expect(totals()).toContain("12 transistors");
    expect(button.disabled).toBe(false);
  });
});
