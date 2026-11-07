import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CircuitStatsTable, type CircuitStatsRow } from "./circuit-stats";

const row = (
  id: string,
  components: number | null,
  transistors: number | null,
): CircuitStatsRow => ({
  id,
  name: `Circuit ${id}`,
  createdAt: `2026-11-0${id}T10:00:00.000Z`,
  components,
  transistors,
});

describe("an account's circuit table", () => {
  it("lists the circuits and totals their components and transistors", () => {
    const markup = renderToStaticMarkup(
      createElement(CircuitStatsTable, {
        circuits: [row("1", 9, 8), row("2", 14, 1200), row("3", 2, null)],
      }),
    );
    // One row per circuit, newest first, and a total row.
    expect(markup.match(/data-testid="circuit-stats-row"/gu)).toHaveLength(3);
    expect(markup.indexOf("Circuit 3")).toBeLessThan(
      markup.indexOf("Circuit 1"),
    );
    expect(markup).toMatch(
      /data-testid="circuit-stats-total"><th scope="row">Total<\/th><td[^>]*>3 circuits<\/td><td[^>]*>25<\/td><td[^>]*>1,208<\/td>/u,
    );
    // A circuit not counted yet says so, and the totals say they leave it out.
    expect(markup).toContain('aria-label="Not counted yet"');
    expect(markup).toContain("1 circuit is not counted yet");
  });

  it("adds the Owner's further columns, totalled too", () => {
    const markup = renderToStaticMarkup(
      createElement(CircuitStatsTable<CircuitStatsRow & { likes: number }>, {
        circuits: [
          { ...row("1", 1, 2), likes: 3 },
          { ...row("2", 1, 2), likes: 4 },
        ],
        columns: [
          { key: "likes", label: "Likes", value: (item) => item.likes },
        ],
        badges: () => ["AI"],
      }),
    );
    expect(markup).toContain(">Likes<");
    expect(markup).toMatch(/Total[\s\S]*>7<\/td><\/tr><\/tfoot>/u);
    expect(markup).toContain('class="circuit-stats-badge">AI<');
  });

  it("offers a Refresh only where the numbers can be read again", () => {
    const circuits = [row("1", 9, 8)];
    expect(
      renderToStaticMarkup(createElement(CircuitStatsTable, { circuits })),
    ).not.toContain("circuit-stats-refresh");
    const refreshing = renderToStaticMarkup(
      createElement(CircuitStatsTable, {
        circuits,
        onRefresh: () => {},
        refreshing: true,
      }),
    );
    expect(refreshing).toMatch(
      /<button[^>]*data-testid="circuit-stats-refresh"[^>]*disabled=""[^>]*>Refreshing…<\/button>/u,
    );
  });

  it("badges each circuit AI, Netlist and Sim, in that order", () => {
    const markup = renderToStaticMarkup(
      createElement(CircuitStatsTable, {
        circuits: [
          {
            ...row("1", 3, 2),
            aiGenerated: true,
            netlistable: true,
            simulatable: true,
          },
          { ...row("2", 3, 2), netlistable: true },
        ],
      }),
    );
    expect(markup.match(/circuit-stats-badge">(\w+)</gu)).toEqual([
      'circuit-stats-badge">Netlist<',
      'circuit-stats-badge">AI<',
      'circuit-stats-badge">Netlist<',
      'circuit-stats-badge">Sim<',
    ]);
  });
});
