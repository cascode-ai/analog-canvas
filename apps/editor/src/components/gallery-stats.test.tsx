import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AuthorStatsView,
  GalleryStatsView,
  countedAgo,
  statsSourceFromSearch,
  statsViewFromSearch,
  type GalleryStatsSummary,
} from "./gallery-stats";

const summary = (
  overrides: Partial<GalleryStatsSummary> = {},
): GalleryStatsSummary => ({
  circuits: 40,
  authors: 4,
  components: 480,
  transistors: 1210,
  counted: 40,
  ai: 10,
  netlist: 36,
  likes: 9,
  liked: 5,
  types: [
    { type: null, circuits: 18 },
    { type: "Amplifiers", circuits: 12 },
    { type: "Filters", circuits: 6 },
    { type: "Power", circuits: 4 },
  ],
  tags: [
    { tag: "amplifier", circuits: 12 },
    { tag: "cmos", circuits: 8 },
  ],
  devices: [
    { kind: "nmos", count: 700 },
    { kind: "pmos", count: 500 },
    { kind: "bjt", count: 10 },
    { kind: "resistor", count: 90 },
    { kind: "inductor", count: 3 },
  ],
  sizes: [
    { key: "0-5", circuits: 8 },
    { key: "6-10", circuits: 12 },
    { key: "11-15", circuits: 10 },
    { key: "16-25", circuits: 6 },
    { key: "26-", circuits: 4 },
  ],
  transistorBins: [
    { key: "0", circuits: 4 },
    { key: "1-5", circuits: 10 },
    { key: "6-10", circuits: 10 },
    { key: "11-20", circuits: 8 },
    { key: "21-50", circuits: 6 },
    { key: "51-", circuits: 2 },
  ],
  weeks: [
    { week: "2026-10-26", human: 3, ai: 1 },
    { week: "2026-11-02", human: 5, ai: 2 },
  ],
  ...overrides,
});

const text = (markup: string, testId: string) =>
  new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`, "u").exec(markup)?.[1];

describe("the Gallery's statistics", () => {
  it("draws the whole Gallery's figures, types, devices and authors", () => {
    const markup = renderToStaticMarkup(
      createElement(GalleryStatsView, {
        stats: {
          summary: summary(),
          topAuthors: [{ author: "Maker", circuits: 30 }],
        },
      }),
    );
    expect(text(markup, "gallery-stats-circuits")).toBe("40");
    expect(text(markup, "gallery-stats-transistors")).toBe("1,210");
    expect(markup).toContain("90% with a netlist · 25% by AI");
    // The ring names its six types; the rest fold into Other types, untagged
    // circuits apart, and only the parts present are listed.
    expect(markup).toContain(">Untagged<");
    expect(markup).toContain(">Other types<");
    expect(markup).toContain("Filters 6");
    expect(markup).not.toContain(">Conversion<");
    // Devices: inductors fold into Other, which says what it holds.
    expect(markup).toContain("Inductors 3");
    expect(markup).toContain(">1,303<");
    // Columns name their ranges; the weeks stack people and AI.
    expect(markup).toContain(">26+<");
    expect(markup).toContain(">AI<");
    expect(markup).toContain(">Maker<");
  });

  it("says so when the Gallery has no public circuit", () => {
    const markup = renderToStaticMarkup(
      createElement(GalleryStatsView, {
        stats: {
          summary: summary({ circuits: 0, authors: 0 }),
          topAuthors: [],
        },
      }),
    );
    expect(markup).toContain('data-testid="gallery-stats-empty"');
  });

  it("says how long ago the figures were counted", () => {
    const now = Date.parse("2026-11-06T12:00:00.000Z");
    expect(countedAgo("2026-11-06T11:59:50.000Z", now)).toBe(
      "Counted just now",
    );
    expect(countedAgo("2026-11-06T11:48:00.000Z", now)).toBe(
      "Counted 12 min ago",
    );
    expect(countedAgo("2026-11-06T10:50:00.000Z", now)).toBe(
      "Counted 1 hour ago",
    );
  });

  it("opens the view and the stores a link names", () => {
    expect(statsViewFromSearch("?tab=statistics&view=mine")).toBe("mine");
    expect(statsViewFromSearch("?tab=statistics")).toBe("gallery");
    expect(statsSourceFromSearch("?source=datasets")).toBe("datasets");
    expect(statsSourceFromSearch("?source=community")).toBe("community");
    expect(statsSourceFromSearch("?source=other")).toBe("all");
  });

  it("says where the circuits come from, and draws datasets apart", () => {
    const sources = [
      { key: "community", name: "Community", circuits: 30 },
      { key: "circuitthink", name: "CircuitThink", circuits: 4 },
      { key: "amsnet", name: "AMS-Net", circuits: 6 },
    ];
    const withDatasets = summary({
      datasets: 10,
      weeks: [{ week: "2026-11-02", human: 5, ai: 2, dataset: 10 }],
    });
    const all = renderToStaticMarkup(
      createElement(GalleryStatsView, {
        stats: { summary: withDatasets, topAuthors: [], sources },
        source: "all",
      }),
    );
    expect(all).toContain("30 community · 10 from datasets");
    expect(all).toContain(">Datasets<");
    expect(all).toContain("by people, AI and datasets");
    const datasets = renderToStaticMarkup(
      createElement(GalleryStatsView, {
        stats: { summary: withDatasets, topAuthors: [], sources },
        source: "datasets",
      }),
    );
    expect(datasets).toContain("CircuitThink · AMS-Net");
    expect(datasets).toContain("Circuits of each dataset");
  });
});

describe("an author's statistics", () => {
  const circuits = [
    {
      id: "c1",
      name: "OTA",
      createdAt: "2026-11-03T10:00:00.000Z",
      components: 12,
      transistors: 9,
    },
  ];

  it("places the author among the Gallery's and compares their spread", () => {
    const markup = renderToStaticMarkup(
      createElement(AuthorStatsView, {
        stats: {
          circuits,
          summary: summary({
            circuits: 10,
            components: 150,
            transistors: 300,
            counted: 10,
            likes: 3,
            liked: 2,
          }),
          rank: { position: 2, authors: 4 },
        },
        library: summary(),
      }),
    );
    expect(text(markup, "author-stats-circuits")).toBe("10");
    expect(markup).toContain("#2 of 4 authors · 25% of the Gallery");
    expect(markup).toContain("15 per circuit · Gallery 12");
    expect(markup).toContain("30 per circuit · Gallery 30.3");
    expect(markup).toContain("2 of 10 circuits liked");
    // Its distributions beside the Gallery's, as shares.
    expect(markup).toContain(">Gallery<");
    expect(markup).toContain(">30%<");
    // And every circuit in the table below.
    expect(markup).toContain('data-testid="circuit-stats-row"');
  });

  it("says what a still-counting total leaves out", () => {
    const markup = renderToStaticMarkup(
      createElement(AuthorStatsView, {
        stats: {
          circuits,
          summary: summary({ circuits: 10, counted: 7 }),
          rank: null,
        },
      }),
    );
    expect(markup).toContain("3 circuits still being counted");
    expect(markup).not.toContain("authors ·");
  });

  it("says so when the author has published nothing", () => {
    const markup = renderToStaticMarkup(
      createElement(AuthorStatsView, {
        stats: { circuits: [], summary: summary({ circuits: 0 }), rank: null },
      }),
    );
    expect(markup).toContain('data-testid="author-stats-empty"');
    expect(markup).not.toContain("<table");
  });
});
