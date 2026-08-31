import { createRoutePath } from "@icm/model";
import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  endpointTestId,
  instanceLabelAnnotationFor,
  maxRoutingCounter,
  previewInstanceValueSource,
} from "./editor-document-helpers";

describe("editor document helpers", () => {
  it("uses stable endpoint identifiers and finds an instance label", () => {
    expect(
      endpointTestId({
        kind: "terminal",
        instanceId: "R1",
        pinName: "1",
      }),
    ).toBe("terminal-R1-1");
    expect(endpointTestId({ kind: "junction", junctionId: "J1" })).toBe(
      "junction-J1",
    );

    const document = createEmptyDocument("doc", "Doc");
    document.annotations.push({
      id: "label-R1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "R1" },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      rotation: 0,
      alignment: "start",
      locked: false,
      visible: true,
      sizeScale: 1,
    });
    expect(instanceLabelAnnotationFor(document, "R1")?.id).toBe("label-R1");
    expect(instanceLabelAnnotationFor(document, "R2")).toBeUndefined();
  });

  it("does not confuse a literal master label with a live Reference label", () => {
    const document = createEmptyDocument("doc", "Doc");
    document.annotations.push({
      id: "master-R1",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "master" }] },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      rotation: 0,
      alignment: "start",
      locked: false,
    });
    expect(instanceLabelAnnotationFor(document, "R1")).toBeUndefined();
  });

  it("finds the highest generated routing counter across document objects", () => {
    const document = createEmptyDocument("doc", "Doc");
    document.nets.push({
      id: "net-ui-7",

      terminals: [],
    });
    document.routes.push(
      createRoutePath({
        id: "route-ui-12",
        netId: "net-ui-7",
        start: { kind: "junction", junctionId: "junction-ui-3" },
        end: { kind: "junction", junctionId: "junction-ui-3" },
        bends: [],
        modes: ["manual"],
      }),
    );
    document.junctions.push({
      id: "junction-ui-3",
      netId: "net-ui-7",
      position: { x: 0, y: 0 },
    });
    expect(maxRoutingCounter(document)).toBe(12);
  });

  it("projects only the selected instance's nonblank parameter draft", () => {
    const instance = {
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "R1",
      netlist: {
        parameters: { value: "1k", keep: "yes" },
      },
    };
    expect(
      previewInstanceValueSource(instance, {
        instanceId: "R1",
        parameters: { value: "2k" },
      }),
    ).toMatchObject({ netlist: { parameters: { value: "2k", keep: "yes" } } });
    expect(
      previewInstanceValueSource(instance, {
        instanceId: "other",
        parameters: { value: "2k" },
      }),
    ).toBe(instance);
  });
});
