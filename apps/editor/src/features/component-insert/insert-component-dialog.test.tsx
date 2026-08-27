import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { builtInSymbols } from "@icm/symbols";

import { InsertComponentDialog } from "./insert-component-dialog";

describe("InsertComponentDialog", () => {
  it("renders an expanded picker, device controls, and one authoritative preview", () => {
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
    // The catalog is permanently open: no collapse control exists and the
    // listbox renders without any toggle interaction.
    expect(markup).not.toContain("Collapse component list");
    expect(markup).not.toContain("insert-picker-toggle");
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('class="insert-symbol-artwork"');
    expect(markup).toContain('aria-label="Component w"');
    expect(markup).toContain('aria-label="Component l"');
    expect(markup).toContain('aria-label="Component m"');
    expect(markup).toContain('aria-label="Placement options"');
    expect(markup).toContain('aria-label="Initial rotation"');
    expect(markup).toContain('aria-label="Reference name"');
    expect(markup).toContain(">Extended Devices</h3>");
    expect(markup).toContain(">Annotations</h3>");
    expect(markup).toContain(">High-voltage devices</h4>");
    expect(markup).toContain('data-testid="insert-component-ndmos"');
    expect(markup).toContain('data-testid="insert-component-pdmos"');
    expect(markup).toContain('data-testid="insert-component-annotation-arrow"');
    expect(markup).toContain(
      'data-testid="insert-component-annotation-polarity-both"',
    );
    expect(markup).toContain("W / m");
    expect(markup).toContain("(Total channel width)");
    expect(markup).toContain("(Finger count, so finger width is W / NF)");
    // The default is Reference on, Value off and disabled until the device
    // parameters carry a displayable projection.
    expect(markup).toContain(">Reference</span>");
    expect(markup).toContain(">Value</span>");
    expect(markup).toContain('disabled=""');
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

    expect(markup).toContain(">Cells</h3>");
    expect(markup).toContain("Place Hierarchical Cell");
    expect(markup).toContain('aria-label="Cell search"');
    expect(markup).toContain('data-testid="insert-cell-document-amplifier"');
    expect(markup).not.toContain('data-testid="insert-component-nmos"');
    expect(markup).toContain(">Amplifier</span>");
    expect(markup).toContain('aria-label="Reference name"');
  });
});
