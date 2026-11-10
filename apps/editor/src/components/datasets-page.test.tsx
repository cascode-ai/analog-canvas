// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatasetsPage } from "./datasets-page";

let root: Root;
let container: HTMLDivElement;
let writeText: ReturnType<typeof vi.fn>;

const comparison = (id: string, verdict: string, category = "") => ({
  id,
  name: `Circuit ${id}`,
  verdict,
  category,
  detail: category,
  reason: verdict === "error" ? "The dataset splits the M4 drain." : "",
  families: ["MOS"],
  components: 6,
  previewRevision: "p",
  figureRevision: "f",
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  // The shared header's account menu asks who is signed in.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({}, { status: 401 })),
  );
  window.history.replaceState(null, "", "/datasets");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let round = 0; round < 4; round += 1) await act(async () => {});
};

const render = async (fetchLike: typeof fetch) => {
  act(() => root.render(<DatasetsPage fetchLike={fetchLike} />));
  await settle();
};

describe("/datasets", () => {
  it("asks no kept circuits of a reader it knows is signed out (#2163)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) =>
        String(input) === "/api/auth/me"
          ? Response.json({ user: null })
          : Response.json({}, { status: 401 }),
      ),
    );
    const asked: string[] = [];
    await render(async (url) => {
      asked.push(String(url));
      return Response.json({ comparisons: [comparison("ag-1", "match")] });
    });
    expect(
      container.querySelector('[data-testid="datasets-row-ag-1"]'),
    ).not.toBeNull();
    expect(asked.some((url) => url.includes("/comparisons"))).toBe(true);
    expect(asked.filter((url) => url.includes("/bookmarks"))).toEqual([]);
  });

  it("asks a signed-out reader to sign in", async () => {
    await render(async () => Response.json({}, { status: 401 }));
    expect(
      container.querySelector('[data-testid="datasets-signed-out"]'),
    ).not.toBeNull();
  });

  it("filters by a clicked verdict, keeps it in the address, and copies a circuit's link", async () => {
    await render(async (url) =>
      Response.json({
        comparisons: String(url).includes("analoggenie")
          ? [
              comparison("ag-1", "match"),
              comparison("ag-2", "error", "Split node"),
            ]
          : String(url).includes("circuitthink")
            ? [comparison("ct-001", "notation", "Source as port")]
            : [],
      }),
    );
    const rows = () =>
      [...container.querySelectorAll("[data-testid^=datasets-row-]")].map(
        (row) => row.getAttribute("data-testid"),
      );
    expect(rows()).toEqual([
      "datasets-row-ag-1",
      "datasets-row-ag-2",
      "datasets-row-ct-001",
    ]);
    const errors = [
      ...container.querySelectorAll(".datasets-legend button"),
    ].find((button) => button.textContent?.includes("Dataset error"))!;
    act(() => (errors as HTMLButtonElement).click());
    expect(rows()).toEqual(["datasets-row-ag-2"]);
    expect(window.location.search).toBe("?verdict=error");
    const copy = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Copy link",
    )!;
    await act(async () => (copy as HTMLButtonElement).click());
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/datasets?source=analoggenie&q=ag-2`,
    );
  });
});
