import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CircuitStatsPanel, type CircuitStatsRow } from "./circuit-stats";

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

const text = (markup: string, testId: string) =>
  new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`, "u").exec(markup)?.[1];

describe("an account's circuit statistics panel", () => {
  it("counts the circuits and totals their components and transistors", () => {
    const markup = renderToStaticMarkup(
      createElement(CircuitStatsPanel, {
        circuits: [row("1", 9, 8), row("2", 14, 1200), row("3", 2, null)],
      }),
    );
    expect(text(markup, "circuit-stats-count")).toBe("3");
    expect(text(markup, "circuit-stats-components")).toBe("25");
    expect(text(markup, "circuit-stats-transistors")).toBe("1,208");
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
      createElement(CircuitStatsPanel<CircuitStatsRow & { likes: number }>, {
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

  it("says so when the account has published nothing", () => {
    const markup = renderToStaticMarkup(
      createElement(CircuitStatsPanel, { circuits: [] }),
    );
    expect(text(markup, "circuit-stats-count")).toBe("0");
    expect(markup).toContain('data-testid="circuit-stats-empty"');
    expect(markup).not.toContain("<table");
  });

  it("offers a Refresh only where the numbers can be read again", () => {
    const circuits = [row("1", 9, 8)];
    expect(
      renderToStaticMarkup(createElement(CircuitStatsPanel, { circuits })),
    ).not.toContain("circuit-stats-refresh");
    const refreshing = renderToStaticMarkup(
      createElement(CircuitStatsPanel, {
        circuits,
        onRefresh: () => {},
        refreshing: true,
      }),
    );
    expect(refreshing).toMatch(
      /<button[^>]*data-testid="circuit-stats-refresh"[^>]*disabled=""[^>]*>Refreshing…<\/button>/u,
    );
  });
});
