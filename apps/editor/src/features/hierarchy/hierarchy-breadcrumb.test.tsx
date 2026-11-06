import { createEmptyProject } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { hierarchyNavigationFixture } from "../../../../../netlists/hierarchy-navigation/fixture";
import { HierarchyBreadcrumb } from "./hierarchy-breadcrumb";

const callbacks = {
  onOpen: vi.fn(),
  onUp: vi.fn(),
  onTop: vi.fn(),
  onShowTree: vi.fn(),
  onShowUses: vi.fn(),
};

describe("HierarchyBreadcrumb", () => {
  it("renders nothing at Top, so a flat Project keeps its canvas", () => {
    const project = createEmptyProject("flat", "Flat");
    expect(
      renderToStaticMarkup(
        <HierarchyBreadcrumb
          project={project}
          activeDocumentId={project.topDocumentId}
          path={[]}
          {...callbacks}
        />,
      ),
    ).toBe("");
  });

  it("shows the exact instance path and the shared use count inside a child", () => {
    const project = hierarchyNavigationFixture();
    const top = project.topDocumentId;
    const markup = renderToStaticMarkup(
      <HierarchyBreadcrumb
        project={project}
        activeDocumentId="amplifier"
        path={[
          {
            parentDocumentId: top,
            instanceId: "X2",
            childDocumentId: "channel",
          },
          {
            parentDocumentId: "channel",
            instanceId: "XA",
            childDocumentId: "amplifier",
          },
        ]}
        {...callbacks}
      />,
    );
    expect(markup).toContain('data-canvas-overlay="hierarchy-breadcrumb"');
    expect(markup).toContain(">Top</button>");
    expect(markup).toContain(">X2: Channel</button>");
    expect(markup).toContain('aria-current="page">XA: Amplifier</span>');
    expect(markup).toContain(">2 uses</button>");
  });

  it("names a directly opened definition and offers a way back to Top", () => {
    const project = hierarchyNavigationFixture();
    const markup = renderToStaticMarkup(
      <HierarchyBreadcrumb
        project={project}
        activeDocumentId="pair"
        path={[]}
        {...callbacks}
      />,
    );
    expect(markup).toContain("Pair (definition)");
    expect(markup).toContain('title="Open the default Top"');
    expect(markup).toContain(">3 uses</button>");
  });
});
