// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CircuitProject } from "@icm/model";

import { hierarchyNavigationFixture } from "../../../../../netlists/hierarchy-navigation/fixture";
import {
  CellHierarchyTree,
  type HierarchyTreeActions,
} from "./cell-hierarchy-tree";

const actions = new Proxy({} as HierarchyTreeActions, {
  get: () => vi.fn(),
});
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has neither; the tree scrolls its open row into view.
  vi.stubGlobal("CSS", {
    escape: (value: string) => JSON.stringify(value).slice(1, -1),
  });
  Element.prototype.scrollIntoView = () => {};
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function rootsOf(project: CircuitProject) {
  await act(async () =>
    root.render(
      <CellHierarchyTree
        project={project}
        activeDocumentId={project.topDocumentId}
        path={[]}
        expandedKeys={[]}
        onExpandedKeysChange={() => {}}
        selectedInstanceIds={[]}
        usesKey={null}
        onUsesKeyChange={() => {}}
        open
        actions={actions}
      />,
    ),
  );
  return [
    ...container.querySelectorAll(
      '[role="treeitem"][aria-level="1"] .hierarchy-node-label',
    ),
  ].map((node) => node.getAttribute("aria-label")?.replace(/^Top · /u, ""));
}

describe("CellHierarchyTree root order", () => {
  it("lists Top first, then keeps every root where it was", async () => {
    const project = hierarchyNavigationFixture();
    project.topDocumentId = "unused";
    expect(await rootsOf(project)).toEqual(["Unused", "dut"]);

    // Switching Top back moves only the badge.
    const switched = structuredClone(project);
    switched.topDocumentId = "top";
    expect(await rootsOf(switched)).toEqual(["Unused", "dut"]);

    // A Cell a refactor leaves unused joins at the end, where definition
    // order would put it between the roots already listed.
    const orphaned = structuredClone(switched);
    for (const instance of orphaned.documents.find((cell) => cell.id === "top")!
      .instances)
      if (instance.netlist?.binding?.kind === "subcircuit")
        instance.netlist.binding.childDocumentId = "amplifier";
    expect(await rootsOf(orphaned)).toEqual(["Unused", "dut", "Channel"]);
  });
});
