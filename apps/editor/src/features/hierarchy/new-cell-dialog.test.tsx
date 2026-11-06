import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { hierarchyNavigationFixture } from "../../../../../netlists/hierarchy-navigation/fixture";
import { NewCellDialog } from "./new-cell-dialog";

describe("NewCellDialog", () => {
  it("names the Cell it places a child in and previews the block", () => {
    const markup = renderToStaticMarkup(
      <NewCellDialog
        project={hierarchyNavigationFixture()}
        parentId="amplifier"
        parentName="Amplifier"
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(markup).toContain("<span>in Amplifier</span>");
    expect(markup).toContain('aria-label="Symbol preview"');
    expect(markup).toContain('aria-label="Add Pins"');
    // Nothing can be created until the Cell has a name.
    expect(markup).toContain(
      '<button type="submit" class="primary" disabled="">Create and place</button>',
    );
  });

  it("creates an unplaced Cell when no parent is given", () => {
    const markup = renderToStaticMarkup(
      <NewCellDialog
        project={hierarchyNavigationFixture()}
        parentId="amplifier"
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(markup).toContain(">New Cell</h2>");
    expect(markup).toContain(">Create Cell</button>");
  });
});
