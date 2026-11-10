import { readFileSync } from "node:fs";

import { buildProjectHierarchy } from "@icm/derived";
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
  newChildFromSelection: vi.fn(),
  place: vi.fn(() => true),
  drop: vi.fn(),
  setTop: vi.fn(),
  remove: vi.fn(),
  newExternal: vi.fn(),
  externals: {
    edit: vi.fn(),
    place: vi.fn(() => true),
    remove: vi.fn(),
    openCaller: vi.fn(),
  },
  newCell: vi.fn(),
  makeUnique: vi.fn(),
  replace: vi.fn(),
  flatten: vi.fn(),
  notice: vi.fn(),
};

const render = (
  overrides: Partial<Parameters<typeof CellHierarchyTree>[0]> = {},
) => {
  const project = overrides.project ?? hierarchyNavigationFixture();
  return renderToStaticMarkup(
    <CellHierarchyTree
      project={project}
      roots={buildProjectHierarchy(project).roots}
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
    // Every Cell nothing calls is a root of its own, listed as a peer.
    expect(markup).not.toContain("Other roots");
    expect(markup).toContain('aria-label="Unused"');
  });

  it("keeps actions on the rows and drops resident menus and notes", () => {
    const markup = render();
    expect(markup).toContain('aria-label="New child Cell in Channel"');
    expect(markup).toContain('aria-label="Place Channel"');
    expect(markup).toContain('aria-label="Channel properties"');
    // Every row but Top's offers the same TOP badge, to move Top there.
    expect(markup.match(/aria-label="Set [^"]+ as Top"/gu)).toHaveLength(3);
    expect(markup).toContain('aria-label="Set Channel as Top"');
    expect(markup).not.toContain("⋯");
    expect(markup).not.toContain(
      "Editing this definition changes all its uses",
    );
  });

  it("explains only its icons on hover; names, badges and counts say it", () => {
    const markup = render();
    const titled = [...markup.matchAll(/<[a-z]+ [^>]*title="([^"]*)"/gu)].map(
      ([, title]) => title,
    );
    expect(titled).toContain("New child Cell in Channel");
    expect(titled).toContain("Collapse all but the open path");
    for (const tag of [
      /<button[^>]*class="hierarchy-node-label"[^>]*>/gu,
      /<[a-z]+[^>]*class="hierarchy-top[^"]*"[^>]*>/gu,
      /<button[^>]*class="hierarchy-uses"[^>]*>/gu,
    ])
      for (const [element] of markup.matchAll(tag))
        expect(element).not.toContain("title=");
  });

  it("hides a row's tools in a place they keep, so hovering never narrows its name (#2175)", () => {
    // Hidden tools that left the layout gave the name their room; on hover
    // they took it back, and a click aimed at the name set Top instead.
    const css = readFileSync(
      new URL("../../styles/editor-hierarchy-tree.css", import.meta.url),
      "utf8",
    );
    for (const tools of [
      /\.hierarchy-node:not\(:hover\) \.hierarchy-set-top \{([^}]*)\}/u,
      /\.hierarchy-node:not\(:hover, :focus-within, \[data-active\]\)\s+\.hierarchy-row-actions \{([^}]*)\}/u,
    ]) {
      const rule = tools.exec(css)?.[1];
      expect(rule).toContain("visibility: hidden;");
      expect(rule).not.toContain("display:");
    }
    // The name opens the row; only the TOP badge, its own button, sets Top.
    const markup = render();
    const name =
      /<button[^>]*class="hierarchy-node-label"[^>]*aria-label="X1: Channel"[^>]*>.*?<\/button>/u.exec(
        markup,
      )?.[0];
    expect(name).toBeDefined();
    expect(name).not.toContain("Top");
  });

  it("starts a new or imported Cell from the tree itself", () => {
    expect(render()).toContain('aria-label="New Cell"');
    expect(render()).not.toContain("Import Cell…");
    expect(render({ actions: { ...actions, importCell: vi.fn() } })).toContain(
      ">Import Cell…</button>",
    );
  });

  it("keeps the roots in place and marks Top where its Cell is used", () => {
    const project = hierarchyNavigationFixture();
    const formerTop = project.topDocumentId;
    project.topDocumentId = "channel";
    const markup = render({
      project,
      activeDocumentId: formerTop,
      expandedKeys: [hierarchyPathKey(formerTop, [])],
    });
    // The tree does not re-root: the former Top keeps its rows, and Channel,
    // now Top but used there, carries the badge on both of its uses.
    expect(markup).toContain('aria-label="X1: Channel"');
    expect(markup).not.toContain('aria-label="Top · Channel"');
    expect(markup.match(/>Top<\/span>/gu)).toHaveLength(2);
    expect(markup).not.toContain('aria-label="Set Channel as Top"');
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

  it("lists external circuits below the Cells, with their uses, only when there are any", () => {
    expect(render()).not.toContain('aria-label="External circuits"');
    const project = hierarchyNavigationFixture();
    project.externalSubcircuitDefinitions.push({
      id: "ext-opamp",
      name: "opamp_ext",
      terminals: [
        { id: "t-in", name: "in", direction: "input" },
        { id: "t-out", name: "out", direction: "output" },
      ],
      formalParameters: [],
      interfaceStatus: "declared",
    });
    const pair = project.documents.find((cell) => cell.id === "pair")!;
    for (const id of ["XU1", "XU2"])
      pair.instances.push({
        id,
        reference: id,
        symbolId: "external-ext-opamp",
        placement: null,
        netlist: {
          binding: { kind: "external-subcircuit", definitionId: "ext-opamp" },
          parameters: {},
        },
      });
    const markup = render({ project });
    expect(markup).toContain('aria-label="External circuits"');
    expect(markup).toContain('aria-label="opamp_ext, external circuit"');
    expect(markup).toContain('aria-label="2 uses of opamp_ext"');
    expect(markup).toContain('aria-label="Place opamp_ext"');
    expect(markup).toContain('aria-label="opamp_ext model"');
    expect(markup).toContain(">New external circuit…</button>");
    expect(markup).not.toContain("External Circuits…");
  });
});
