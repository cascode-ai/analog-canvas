import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmptyProject, createEmptyDocument } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { withProjectComponentDefinitions } from "@icm/symbols";
import { compareGalleryVersions } from "./gallery-version-diff";
import {
  branchGalleryVersion,
  loadGalleryVersionProject,
  galleryVersionBranchUrl,
} from "./gallery-version-project";

function fixture() {
  const project = createEmptyProject("history", "Amplifier");
  const document = project.documents[0]!;
  document.instances = ["M1", "M2"].map((id, index) => ({
    id,
    reference: id,
    symbolId: "nmos",
    placement: {
      position: { x: 100 * index, y: 0 },
      rotation: 0,
      mirror: "none",
    },
    netlist: {
      binding: { kind: "model", deviceClass: "mos", name: "NMOS" },
      parameters: { w: "2u", l: "150n" },
    },
  }));
  document.nets = [
    {
      id: "n1",
      terminals: document.instances.map(({ id }) => ({
        instanceId: id,
        pinName: "D",
      })),
    },
  ];
  return project;
}

describe("Gallery component history", () => {
  it("reports parameter, name and placement edits on the same device without mutating either snapshot", () => {
    const before = fixture();
    const after = structuredClone(before);
    const instance = after.documents[0]!.instances[0]!;
    instance.reference = "M3";
    instance.netlist!.parameters.w = "4u";
    instance.placement!.rotation = 90;
    const frozen = JSON.stringify([before, after]);
    const changes = compareGalleryVersions(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      instanceId: "M1",
      name: "M3",
      status: "modified",
    });
    expect(changes[0]!.fields).toEqual(
      expect.arrayContaining([
        { path: "netlist.parameters.w", before: "2u", after: "4u" },
        { path: "placement.rotation", before: "0", after: "90" },
        { path: "reference", before: "M1", after: "M3" },
      ]),
    );
    expect(JSON.stringify([before, after])).toBe(frozen);
  });
  it("distinguishes recreation from rename, detects additions/deletions and affected neighbors", () => {
    const before = fixture();
    const after = structuredClone(before);
    after.documents[0]!.instances[1]!.id = "new-mos";
    after.documents[0]!.nets[0]!.terminals[1]!.instanceId = "new-mos";
    expect(
      compareGalleryVersions(before, after).map(({ instanceId, status }) => [
        instanceId,
        status,
      ]),
    ).toEqual([
      ["M1", "modified"],
      ["M2", "removed"],
      ["new-mos", "added"],
    ]);
  });
  it("ignores transient net IDs, object-key order and revision counters", () => {
    const before = fixture();
    const after = structuredClone(before);
    after.documents[0]!.nets[0]!.id = "regenerated-net";
    after.documents[0]!.nets[0]!.terminals.reverse();
    after.documents[0]!.instances.reverse();
    after.documents[0]!.instances[0]!.netlist!.parameters = {
      l: "150n",
      w: "2u",
    };
    after.structureRevision++;
    expect(compareGalleryVersions(before, after)).toEqual([]);
  });
  it("identifies disconnections and NoConnect changes", () => {
    const before = fixture();
    const after = structuredClone(before);
    after.documents[0]!.nets[0]!.terminals.pop();
    after.documents[0]!.noConnects.push({
      id: "nc",
      endpoint: { kind: "terminal", instanceId: "M2", pinName: "D" },
    });
    const changes = compareGalleryVersions(before, after);
    expect(changes.map((item) => item.instanceId)).toEqual(["M1", "M2"]);
    expect(
      changes[1]!.fields.some((field) => field.path === "noConnects"),
    ).toBe(true);
  });

  it("ignores wire-only style changes but flags component appearance and Cell parameter defaults", () => {
    const before = fixture();
    const after = structuredClone(before);
    after.documents[0]!.presentation.styleOverrides = {
      wireStrokeScale: 2,
      junctionRadiusScale: 2,
    };
    expect(compareGalleryVersions(before, after)).toEqual([]);
    after.documents[0]!.presentation.styleOverrides = { symbolStrokeScale: 2 };
    expect(compareGalleryVersions(before, after)).toHaveLength(2);
    const defaults = structuredClone(before);
    defaults.documents[0]!.netlist!.formalParameters.push({
      name: "W",
      defaultValue: "4u",
    });
    expect(
      compareGalleryVersions(before, defaults)[0]!.fields.some(
        (field) => field.path === "cellParameters",
      ),
    ).toBe(true);
  });
  it("keeps name-bound labels in the diff even if their anchor is free", () => {
    const before = fixture();
    before.documents[0]!.annotations.push({
      id: "label",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "M1" },
      anchor: { kind: "free", position: { x: 0, y: 10 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const after = structuredClone(before);
    after.documents[0]!.annotations[0]!.rotation = 90;
    expect(compareGalleryVersions(before, after)).toMatchObject([
      { instanceId: "M1", status: "modified", fields: [{ path: "labels" }] },
    ]);
  });
  it("compares child Cells independently and marks their removal", () => {
    const before = fixture();
    const child = createEmptyDocument("child", "Child");
    child.instances = structuredClone(before.documents[0]!.instances);
    before.documents.push(child);
    const after = structuredClone(before);
    after.documents.pop();
    expect(
      compareGalleryVersions(before, after).map((item) => [
        item.documentId,
        item.status,
      ]),
    ).toEqual([
      ["child", "removed"],
      ["child", "removed"],
    ]);
  });
  it("detects embedded component definition changes even with identical instances", () => {
    const before = withProjectComponentDefinitions(fixture());
    const after = structuredClone(before);
    const definition = after.componentDefinitions!.find(
      (item) => item.symbol.id === "nmos",
    )!;
    definition.symbol.name = "Revised NMOS";
    expect(
      compareGalleryVersions(before, after).map((item) => item.status),
    ).toEqual(["modified", "modified"]);
  });
  it("branches the full parsed Project with independent identity, keeping definitions, sources and all Cells", () => {
    const original = parseProject(
      readFileSync(
        "apps/editor/src/examples/five-transistor-ota-sky130.icproj.json",
        "utf8",
      ),
    );
    const branch = branchGalleryVersion(original, 3);
    expect(branch.id).not.toBe(original.id);
    expect(branch.name).toBe(`${original.name} · branch v3`);
    expect({
      ...branch,
      id: original.id,
      name: original.name,
      structureRevision: original.structureRevision,
    }).toEqual(original);
    branch.documents[0]!.name = "Edited branch";
    expect(original.documents[0]!.name).not.toBe("Edited branch");
    expect(parseProject(serializeProject(branch)).id).toBe(branch.id);
  });
  it("loads validated snapshots with no cache and keeps unavailable history an explicit error", async () => {
    let called = "";
    const project = fixture();
    const fetchLike = async (
      url: string | URL | Request,
      options?: RequestInit,
    ) => {
      called = String(url);
      expect(options?.cache).toBe("no-store");
      expect(options?.credentials).toBe("same-origin");
      return Response.json({ projectText: serializeProject(project) });
    };
    expect((await loadGalleryVersionProject("entry", "v1", fetchLike)).id).toBe(
      project.id,
    );
    expect(called).toBe("/api/gallery/entry/versions/v1/project");
    await expect(
      loadGalleryVersionProject(
        "entry",
        "expired",
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow("unavailable");
    await expect(
      loadGalleryVersionProject("entry", undefined, async () =>
        Response.json({ projectText: "invalid" }),
      ),
    ).rejects.toThrow();
    expect(galleryVersionBranchUrl("entry", "v1", 3)).toBe(
      "/editor?history=entry&version=v1&versionNo=3",
    );
  });
});
