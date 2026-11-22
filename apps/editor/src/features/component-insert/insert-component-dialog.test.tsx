import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { builtInSymbols } from "@icm/symbols";

import { InsertComponentDialog } from "./insert-component-dialog";

describe("InsertComponentDialog", () => {
  it("finds a Project's components under their own names", () => {
    const base = builtInSymbols.find((symbol) => symbol.id === "resistor")!;
    const decoder = { ...base, id: "user-a-r1", name: "4-to-16 Decoder" };
    const amplifier = {
      ...base,
      id: "user-b-r1",
      name: "Rail-Limited Diff Amp",
    };
    const master = { ...base, id: "external-c", name: "c" };
    const markup = renderToStaticMarkup(
      <InsertComponentDialog
        open
        styleProfileId="razavi-textbook-v1"
        recentSymbolIds={[]}
        cells={[]}
        projectComponents={[
          { symbol: decoder, definition: { symbol: decoder } },
        ]}
        externalDefinitions={[
          {
            definitionId: "a",
            masterName: "rail_amp",
            symbol: amplifier,
            displayName: amplifier.name,
          },
          { definitionId: "c", masterName: "plain_master", symbol: master },
        ]}
        onApply={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(markup).toContain(">4-to-16 Decoder</span>");
    expect(markup).toContain(">Rail-Limited Diff Amp</span>");
    expect(markup).not.toContain(">rail_amp</span>");
    expect(markup).toContain('data-testid="insert-category-in-this-project"');
    // A master that was never a published component keeps its own group.
    expect(markup).toContain(">plain_master</span>");
    expect(markup).toContain('data-testid="insert-category-external-masters"');
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
    expect(markup).toContain("insert-component-dialog insert-cell-dialog");
    expect(markup).toContain('aria-label="Cell search"');
    expect(markup).toContain('data-testid="insert-cell-document-amplifier"');
    expect(markup).not.toContain('data-testid="insert-component-nmos"');
    expect(markup).toContain(">Amplifier</span>");
  });
});
