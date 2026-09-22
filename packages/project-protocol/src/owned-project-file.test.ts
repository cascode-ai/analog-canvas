import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import {
  withProjectComponentDefinitions,
  createProjectSymbolResolver,
} from "@icm/symbols";
import { renderDocumentSvg } from "@icm/render-svg";
import { analyzeDesignNetlist } from "@icm/netlist";
import {
  parseProject,
  serializeProject,
  tryParseProjectWithMetadata,
  CURRENT_PROJECT_FILE_VERSION,
  canonicalConnectionIndexes,
} from "./index.js";
import { planProjectCodeCommit } from "../../../apps/editor/src/features/project-code/project-code.js";

const fixture = () =>
  parseProject(
    readFileSync(
      "fixtures/projects/differential-stage/project.icproj.json",
      "utf8",
    ),
  );

describe("instance-owned portable source", () => {
  it("round-trips all authored fields, rendering, and electrical analysis exactly", () => {
    const before = withProjectComponentDefinitions(fixture());
    const encoded = serializeProject(before);
    const loaded = parseProject(encoded);
    expect(canonicalConnectionIndexes(loaded)).toEqual(
      canonicalConnectionIndexes(before),
    );
    expect(JSON.parse(encoded).schemaVersion).toBe(
      CURRENT_PROJECT_FILE_VERSION,
    );
    expect(tryParseProjectWithMetadata(encoded)).toMatchObject({
      ok: true,
      migrated: false,
    });
    expect(serializeProject(loaded)).toBe(encoded);
    const resolver = createProjectSymbolResolver(loaded, []);
    for (const document of before.documents) {
      expect(
        renderDocumentSvg(
          loaded.documents.find((d) => d.id === document.id)!,
          resolver,
        ),
      ).toBe(renderDocumentSvg(document, resolver));
    }
    expect(analyzeDesignNetlist(loaded)).toEqual(analyzeDesignNetlist(before));
  });

  it("owns parameter/name labels in the same editable instance and keeps independent geometry", () => {
    const before = fixture();
    const instance = before.documents[0]!.instances.find((i) => i.reference)!;
    before.documents[0]!.annotations.push({
      id: "owned-name",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: instance.id },
      anchor: {
        kind: "object",
        objectId: instance.id,
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 10, y: 20 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const source = JSON.parse(serializeProject(before));
    const device = source.documents[0].instances.find(
      (i: any) => i.id === instance.id,
    );
    expect(device.type).toBe(instance.symbolId);
    expect(device.name).toBe(instance.reference);
    expect(device.labels.length).toBeGreaterThan(0);
    expect(
      source.documents[0].annotations.some(
        (label: any) => label.bind?.instanceId === instance.id,
      ),
    ).toBe(false);
    device.name = "M_RENAMED";
    device.coordinate[0] += 100;
    const commit = planProjectCodeCommit(
      before,
      JSON.stringify(source),
      before.topDocumentId,
    );
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    const after = commit.project.documents[0]!.instances.find(
      (i) => i.id === instance.id,
    )!;
    expect(after.reference).toBe("M_RENAMED");
    expect(after.placement!.position.x).toBe(
      instance.placement!.position.x + 100,
    );
    expect(commit.project.documents[0]!.annotations).toEqual(
      before.documents[0]!.annotations,
    );
    expect(commit.project.documents[0]!.nets).toEqual(
      canonicalConnectionIndexes(before).documents[0]!.nets,
    );
  });

  it("round-trips a label-only named parameter display in schema 61", () => {
    const before = createEmptyProject("parameter-display", "Parameter display");
    const document = before.documents[0]!;
    const instance = {
      id: "T1",
      symbolId: "tcoil",
      reference: "T1",
      netlist: { parameters: { l1: "2n", l2: "3n", k: "0.9", cb: "1p" } },
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    document.instances.push(instance);
    const parameter = "l1";
    document.annotations.push({
      id: "owned-parameter-label-only",
      kind: "instance-value",
      binding: {
        kind: "instance-value",
        instanceId: instance.id,
        parameter,
        showValue: false,
      },
      anchor: {
        kind: "object",
        objectId: instance.id,
        localOffset: { x: 0, y: 20 },
        fallbackPosition: { x: 10, y: 40 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const portable = withProjectComponentDefinitions(before);

    const source = JSON.parse(serializeProject(portable));
    expect(source.schemaVersion).toBe(61);
    const encodedInstance = source.documents[0].instances.find(
      (item: any) => item.id === instance.id,
    );
    expect(
      encodedInstance.labels.find(
        (label: any) => label.id === "owned-parameter-label-only",
      ).bind,
    ).toEqual({ parameter, showValue: false });
    expect(
      parseProject(JSON.stringify(source)).documents[0]!.annotations.find(
        (annotation) => annotation.id === "owned-parameter-label-only",
      )?.binding,
    ).toEqual({
      kind: "instance-value",
      instanceId: instance.id,
      parameter,
      showValue: false,
    });

    source.schemaVersion = 60;
    expect(() => parseProject(JSON.stringify(source))).toThrow(
      /Unknown field: showValue/,
    );
  });

  it("retains orphan placement, cross-owner anchors, rich text, hidden labels, and arbitrary IDs", () => {
    const project = createEmptyProject("owned", "Owned");
    const d = project.documents[0]!;
    d.instances.push(
      { id: "A:1/2", symbolId: "resistor", reference: "R1", placement: null },
      { id: "B", symbolId: "resistor", placement: null },
    );
    d.annotations.push({
      id: "cross",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "A:1/2" },
      anchor: {
        kind: "object",
        objectId: "B",
        localOffset: { x: 10, y: 20 },
        fallbackPosition: { x: 100, y: 120 },
      },
      alignment: "end",
      rotation: 90,
      locked: true,
      visible: false,
      textColor: "#123456",
    });
    const prepared = withProjectComponentDefinitions(project);
    expect(parseProject(serializeProject(project))).toEqual(prepared);
    const source = JSON.parse(serializeProject(project));
    expect(source.documents[0].instances[0].labels[0].anchor.objectId).toBe(
      "B",
    );
    expect(source.documents[0].instances[0].coordinate).toBeNull();
  });

  it("keeps instance defaults in the file and makes them editable", () => {
    const source = JSON.parse(serializeProject(fixture()));
    source.defaults.instance.rotation = 90;
    const expected = source.documents[0].instances
      .filter((i: any) => i.coordinate && i.rotation === undefined)
      .map((i: any) => i.id);
    const result = parseProject(JSON.stringify(source));
    for (const instance of result.documents[0]!.instances.filter((i) =>
      expected.includes(i.id),
    ))
      expect(instance.placement!.rotation).toBe(90);
  });

  it.each(["placement", "symbolId", "netlist"])(
    "rejects a second conflicting %s representation",
    (key) => {
      const source = JSON.parse(serializeProject(fixture()));
      source.documents[0].instances[0][key] = {};
      expect(tryParseProjectWithMetadata(JSON.stringify(source))).toMatchObject(
        {
          ok: false,
          diagnostics: [{ path: ["documents", 0, "instances", 0, key] }],
        },
      );
    },
  );
  it("rejects missing/invalid defaults without discarding edits", () => {
    const source = JSON.parse(serializeProject(fixture()));
    source.defaults.instance.rotation = null;
    expect(tryParseProjectWithMetadata(JSON.stringify(source))).toMatchObject({
      ok: false,
    });
    delete source.defaults;
    expect(tryParseProjectWithMetadata(JSON.stringify(source))).toMatchObject({
      ok: false,
    });
  });

  it("stores network identity anchors without a second editable membership index", () => {
    const source = JSON.parse(serializeProject(fixture()));
    const document = source.documents[0];
    expect(
      document.nets.every((n: any) => !Object.hasOwn(n, "terminals")),
    ).toBe(true);
    expect(document.routes.every((r: any) => !Object.hasOwn(r, "netId"))).toBe(
      true,
    );
    expect(
      document.junctions.every((j: any) => !Object.hasOwn(j, "netId")),
    ).toBe(true);
    document.nets[0].terminals = [["incomplete"]];
    expect(tryParseProjectWithMetadata(JSON.stringify(source))).toMatchObject({
      ok: false,
    });
  });

  it("refuses unknown edits and missing definitions instead of silently dropping them", () => {
    const source = JSON.parse(serializeProject(fixture()));
    source.documents[0].instances[0].unknownSetting = 7;
    expect(tryParseProjectWithMetadata(JSON.stringify(source))).toMatchObject({
      ok: false,
    });
    delete source.documents[0].instances[0].unknownSetting;
    delete source.componentDefinitions;
    expect(tryParseProjectWithMetadata(JSON.stringify(source))).toMatchObject({
      ok: false,
      diagnostics: [{ path: ["componentDefinitions"] }],
    });
  });
});
