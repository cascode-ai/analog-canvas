import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { builtInSymbols } from "@icm/symbols";

import { InsertComponentDialog } from "./insert-component-dialog";

describe("InsertComponentDialog", () => {
  it("renders one flat quick-pick grid with a tile per candidate", () => {
    const markup = renderToStaticMarkup(
      <InsertComponentDialog
        open
        styleProfileId="razavi-textbook-v1"
        recentSymbolIds={["nmos"]}
        cells={[]}
        onApply={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-label="Component search"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('class="insert-tile-grid"');
    // Every candidate is a tile with its artwork and name; the grid is flat,
    // so no category headings section the quick pick.
    expect(markup).toContain('class="insert-symbol-artwork"');
    expect(markup).toContain('data-testid="insert-component-resistor"');
    expect(markup).toContain('data-testid="insert-component-ndmos"');
    expect(markup).toContain('data-testid="insert-component-annotation-arrow"');
    expect(markup).toContain(
      'data-testid="insert-component-annotation-polarity-both"',
    );
    expect(markup).toContain(
      'data-testid="insert-component-annotation-ellipsis"',
    );
    expect(markup).not.toContain("<h3");
    expect(markup).not.toContain("<h4");
    // Library order: transistors lead, categories stay together, and the
    // category filter chips render in the same order, all shown by default.
    const nmos = markup.indexOf('data-testid="insert-component-nmos"');
    const resistor = markup.indexOf('data-testid="insert-component-resistor"');
    const arrow = markup.indexOf(
      'data-testid="insert-component-annotation-arrow"',
    );
    expect(nmos).toBeGreaterThan(-1);
    expect(nmos).toBeLessThan(resistor);
    expect(resistor).toBeLessThan(arrow);
    expect(markup).toContain('data-testid="insert-category-transistors"');
    expect(markup).toContain('data-testid="insert-category-annotations"');
    expect(markup).not.toContain('aria-pressed="false"');
    // Per-device setup moved to post-placement Properties: the quick pick
    // carries no parameter, reference, rotation, or rail-name fields.
    expect(markup).not.toContain('aria-label="Component w"');
    expect(markup).not.toContain('aria-label="Reference name"');
    expect(markup).not.toContain('aria-label="Initial rotation"');
    expect(markup).not.toContain('aria-label="Power rail Net name"');
    expect(markup).not.toContain(">Apply</button>");
    expect(markup).not.toContain("library-component-");
  });

  it("does not render while closed", () => {
    expect(
      renderToStaticMarkup(
        <InsertComponentDialog
          open={false}
          styleProfileId="razavi-textbook-v1"
          recentSymbolIds={[]}
          cells={[]}
          onApply={() => undefined}
          onCancel={() => undefined}
        />,
      ),
    ).toBe("");
  });

  it("makes Cell placement an explicitly filtered picker", () => {
    const symbol = builtInSymbols.find(
      (candidate) => candidate.id === "resistor",
    )!;
    const markup = renderToStaticMarkup(
      <InsertComponentDialog
        open
        styleProfileId="razavi-textbook-v1"
        recentSymbolIds={[]}
        scope="cells"
        cells={[
          {
            childDocumentId: "document-amplifier",
            cellName: "Amplifier",
            symbol,
          },
        ]}
        onApply={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(markup).toContain("Place Hierarchical Cell");
    expect(markup).toContain('aria-label="Cell search"');
    expect(markup).toContain('data-testid="insert-cell-document-amplifier"');
    expect(markup).not.toContain('data-testid="insert-component-nmos"');
    expect(markup).toContain(">Amplifier</span>");
  });
});
