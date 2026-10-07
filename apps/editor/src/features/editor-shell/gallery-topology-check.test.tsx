import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createEmptyProject } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TopologyTaskState } from "./gallery-topology-task";
import { GalleryTopologyCheck } from "./gallery-topology-check";

const store = vi.hoisted(() => ({
  state: null as unknown as TopologyTaskState,
}));
vi.mock("./gallery-topology-task", () => ({
  getGalleryTopologyTask: () => ({
    subscribe: () => () => {},
    getSnapshot: () => store.state,
    start: vi.fn(),
    cancel: vi.fn(),
  }),
}));
const message = "Instance G1 requires two selected control Nets";
function fixture() {
  const project = createEmptyProject("controls", "Controls");
  project.documents[0]!.instances.push({
    id: "G1",
    reference: "G1",
    symbolId: "vccs",
    placement: null,
    netlist: { parameters: { gm: "1m" }, control: { kind: "voltage" } },
  });
  return project;
}
function render(project = fixture()) {
  return renderToStaticMarkup(createElement(GalleryTopologyCheck, { project }));
}
describe("duplicate-check snapshot freshness", () => {
  beforeEach(() => {
    store.state = {
      snapshot: parseProject(serializeProject(fixture())),
      sourceProject: null,
      report: {
        scanned: 0,
        total: 0,
        comparable: 0,
        matches: [],
        uncheckable: 0,
        complete: true,
        sourceError: message,
      },
      running: false,
      failure: null,
      noticeDismissed: false,
      durable: true,
    };
  });
  it("recognizes restored equal content despite losing the page-local reference", () => {
    const html = render();
    expect(html).not.toContain("Canvas changed");
    expect(html).not.toContain("Historical");
    expect(html).toContain('role="alert"');
    expect(html).toContain(message);
  });
  it("ignores revision-only changes, including undo to the checked content", () => {
    const project = fixture();
    project.structureRevision += 2;
    project.documents[0]!.revision += 2;
    expect(render(project)).not.toContain("Canvas changed");
  });
  it("demotes old missing-control errors after the control selection is repaired", () => {
    const project = fixture();
    project.documents[0]!.instances[0]!.netlist!.control = {
      kind: "voltage",
      positiveNetId: "p",
      negativeNetId: "n",
    };
    const html = render(project);
    expect(html).toContain("Canvas changed");
    expect(html).toContain("Historical check only");
    expect(html).toContain(message);
    expect(html).not.toContain('role="alert"');
  });
  it("identifies a restored check belonging to a different Project", () => {
    const project = fixture();
    project.id = "different-project";
    expect(render(project)).toContain("another Project or Cell");
    expect(render(project)).not.toContain('role="alert"');
  });
  it("shows another Cell's results nowhere, only that a check is waiting (#1417)", () => {
    const { sourceError: _stale, ...report } = store.state.report!;
    store.state.report = { ...report, comparable: 699, matches: [] };
    const project = fixture();
    project.id = "different-project";
    const html = render(project);
    expect(html).toContain("Controls");
    expect(html).not.toContain("699 comparable");
    expect(html).not.toContain("No comparable Gallery circuits");
    expect(html).toContain(">Check Duplicate</button>");
  });
  it("identifies a different root Cell even within the same Project", () => {
    const project = fixture();
    project.documents.push({
      ...structuredClone(project.documents[0]!),
      id: "child",
      netlist: { name: "child", terminals: [], formalParameters: [] },
    });
    project.topDocumentId = "child";
    expect(render(project)).toContain("another Project or Cell");
  });
  it("keeps current transport failures actionable even with historical results", () => {
    store.state.failure = "Could not start the server check.";
    const project = fixture();
    project.name = "Changed";
    expect(render(project)).toContain('role="alert"');
    expect(render(project)).toContain(store.state.failure);
  });
});
