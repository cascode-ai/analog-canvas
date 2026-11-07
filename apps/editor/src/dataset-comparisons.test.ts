import { describe, expect, it } from "vitest";
import {
  NO_FILTERS,
  countBy,
  filtersFromSearch,
  rowsWithout,
  searchOfFilters,
  sizeBinOf,
  sortedComparisons,
  toggleCategory,
  toggleVerdict,
  type DatasetComparison,
} from "./dataset-comparisons";

const row = (
  id: string,
  verdict: DatasetComparison["verdict"],
  category: string,
  components: number,
  families: string[] = ["MOS"],
): DatasetComparison => ({
  id,
  source: id.startsWith("ct-") ? "circuitthink" : "analoggenie",
  name: `Circuit ${id}`,
  verdict,
  category,
  detail: "",
  reason: "",
  families,
  components,
  previewRevision: "p",
  figureRevision: "f",
});

const rows = [
  row("ag-10", "match", "", 3),
  row("ag-9", "error", "Split node", 15, ["MOS", "BJT"]),
  row("ag-100", "error", "Wrong connection", 25),
  row("ag-11", "notation", "Source as port", 7),
  row("ct-002", "error", "Split node", 9),
];

describe("dataset comparison page logic", () => {
  it("counts each chart over the rows the other filters leave", () => {
    const filters = {
      ...NO_FILTERS,
      verdict: "error" as const,
      category: "Split node",
    };
    expect(rowsWithout(rows, filters).map((r) => r.id)).toEqual([
      "ag-9",
      "ct-002",
    ]);
    // The verdict chart ignores its own choice and the category under it.
    expect(
      countBy(
        rowsWithout(rows, filters, "verdict", "category"),
        (r) => r.verdict,
      ),
    ).toEqual([
      ["error", 3],
      ["match", 1],
      ["notation", 1],
    ]);
    // The category chart keeps the verdict, not the category.
    expect(
      countBy(rowsWithout(rows, filters, "category"), (r) => r.category),
    ).toEqual([
      ["Split node", 2],
      ["Wrong connection", 1],
    ]);
    expect(
      rowsWithout(rows, {
        ...NO_FILTERS,
        size: sizeBinOf(15),
        family: "BJT",
      }).map((r) => r.id),
    ).toEqual(["ag-9"]);
    expect(
      rowsWithout(rows, { ...NO_FILTERS, query: "CT-0" }).map((r) => r.id),
    ).toEqual(["ct-002"]);
  });

  it("picks a category with its verdict and drops one the new verdict lacks", () => {
    const picked = toggleCategory(NO_FILTERS, "Split node", "error");
    expect(picked).toMatchObject({ verdict: "error", category: "Split node" });
    expect(toggleCategory(picked, "Split node", "error").category).toBeNull();
    expect(toggleVerdict(picked, "notation", rows)).toMatchObject({
      verdict: "notation",
      category: null,
    });
    expect(toggleVerdict(picked, "error", rows)).toMatchObject({
      verdict: null,
      category: "Split node",
    });
  });

  it("sorts by number within a dataset, size or verdict", () => {
    expect(sortedComparisons(rows, "id").map((r) => r.id)).toEqual([
      "ag-9",
      "ag-10",
      "ag-11",
      "ag-100",
      "ct-002",
    ]);
    expect(sortedComparisons(rows, "largest")[0]!.id).toBe("ag-100");
    expect(sortedComparisons(rows, "errors").at(-1)!.id).toBe("ag-10");
  });

  it("keeps the filters in the address and ignores unknown values", () => {
    const filters = {
      ...NO_FILTERS,
      source: "analoggenie",
      verdict: "error" as const,
      category: "Split node",
      size: 3,
      family: "BJT",
      query: "ota",
      sort: "errors" as const,
      view: "grid" as const,
    };
    const search = searchOfFilters(filters);
    expect(search).toBe(
      "?source=analoggenie&verdict=error&category=Split+node&size=13%E2%80%9320&contains=BJT&q=ota&sort=errors&view=grid",
    );
    expect(filtersFromSearch(search)).toEqual(filters);
    expect(searchOfFilters(NO_FILTERS)).toBe("");
    expect(
      filtersFromSearch("?verdict=bad&sort=x&view=y&size=9&contains=Tube"),
    ).toEqual(NO_FILTERS);
  });
});
