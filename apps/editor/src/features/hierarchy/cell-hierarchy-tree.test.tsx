import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { hierarchyNavigationFixture } from "../../../../../netlists/hierarchy-navigation/fixture";
import {
  CellHierarchyTree,
  type HierarchyTreeActions,
} from "./cell-hierarchy-tree";
import { hierarchyPathKey } from "./project-hierarchy";

const actions: HierarchyTreeActions = {
  open: vi.fn(),
  openDefinition: vi.fn(),
  properties: vi.fn(),
  rename: vi.fn(),
  newChild: vi.fn(),
  place: vi.fn(() => true),
  drop: vi.fn(),
  setTop: vi.fn(),
  remove: vi.fn(),
  external: vi.fn(),
  notice: vi.fn(),
};

const render = (
  overrides: Partial<Parameters<typeof CellHierarchyTree>[0]> = {},
) => {
  const project = hierarchyNavigationFixture();
  return renderToStaticMarkup(
    <CellHierarchyTree
      project={project}
      activeDocumentId={project.topDocumentId}
      path={[]}
      expandedKeys={[hierarchyPathKey(project.topDocumentId, [])]}
      onExpandedKeysChange={vi.fn()}
      selectedInstanceIds={[]}
      usesKey={null}
      onUsesKeyChange={vi.fn()}
      open
      actions={actions}
      {...overrides}
    />,
  );
};

describe("CellHierarchyTree", () => {
  it("shows each occurrence as one tree row with its shared use count", () => {
    const markup = render();
    expect(markup).toContain('role="tree"');
    expect(markup).toContain('aria-label="X1: Channel"');
    expect(markup).toContain('aria-label="X2: Channel"');
    expect(markup).toContain(">×2</button>");
    expect(markup).toContain(">Top</span>");
    // Detached roots stay in the tree, folded under one quiet header.
    expect(markup).toContain("Other roots (1)");
    expect(markup).not.toContain('aria-label="Unused"');
  });

  it("keeps actions on the rows and drops resident menus and notes", () => {
    const markup = render();
    expect(markup).toContain('aria-label="New child Cell in Channel"');
    expect(markup).toContain('aria-label="Place Channel"');
    expect(markup).toContain('aria-label="Channel properties"');
    expect(markup).not.toContain("⋯");
    expect(markup).not.toContain(
      "Editing this definition changes all its uses",
    );
  });

  it("lists a row's uses under it when asked", () => {
    const project = hierarchyNavigationFixture();
    const top = project.topDocumentId;
    const key = hierarchyPathKey(top, [
      { parentDocumentId: top, instanceId: "X1", childDocumentId: "channel" },
    ]);
    const markup = render({ usesKey: key });
    expect(markup).toContain('aria-label="Uses of Channel"');
    expect(markup).toContain("Top / X2: Channel");
  });
});
