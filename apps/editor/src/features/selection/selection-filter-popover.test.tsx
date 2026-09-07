import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SelectionFilterPopover } from "./selection-filter-popover";
import { DEFAULT_SELECTION_FILTER } from "./selection-filter";

describe("SelectionFilterPopover", () => {
  it("exposes grouped current selection classes and presets", () => {
    const markup = renderToStaticMarkup(
      <SelectionFilterPopover
        open
        filter={DEFAULT_SELECTION_FILTER}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(markup).toContain('data-testid="selection-filter-popover"');
    expect(markup).toContain("Selection Filter");
    expect(markup).toContain("Instances");
    expect(markup).toContain("Wires");
    expect(markup).toContain("Net / power names");
    expect(markup).toContain("Note text / callouts");
    expect(markup).toContain(">All<");
    expect(markup).toContain(">None<");
    expect(markup).toContain(">Default<");
  });

  it("renders nothing while closed", () => {
    expect(
      renderToStaticMarkup(
        <SelectionFilterPopover
          open={false}
          filter={DEFAULT_SELECTION_FILTER}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    ).toBe("");
  });
});
