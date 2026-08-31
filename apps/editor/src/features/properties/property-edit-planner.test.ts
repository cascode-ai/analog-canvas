import { createRoutePath } from "@icm/model";
import { resolveDocumentRoutingGeometry } from "@icm/derived";
import { createEmptyProject } from "@icm/model";
import type { Annotation } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";

import { createPropertyEditPlanner } from "./property-edit-planner";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function fixture() {
  const project = createEmptyProject("project", "Project");
  const document = project.documents[0]!;
  const routing = resolveDocumentRoutingGeometry(document, resolver);
  const setStatus = vi.fn();
  return {
    project,
    document,
    resolver,
    setStatus,
    routeGeometryRecords: document.routes.flatMap((route) => {
      const geometry = routing.routes.get(route.id);
      return geometry ? [{ route, geometry }] : [];
    }),
  };
}

function routedFixture() {
  const input = fixture();
  input.document.nets.push({ id: "net", terminals: [] });
  input.document.junctions.push(
    {
      id: "j1",
      netId: "net",
      position: { x: 0, y: 0 },
      role: "route-anchor",
    },
    {
      id: "j2",
      netId: "net",
      position: { x: 100, y: 0 },
      role: "route-anchor",
    },
  );
  input.document.routes.push(
    createRoutePath({
      id: "route",
      netId: "net",
      start: { kind: "junction", junctionId: "j1" },
      end: { kind: "junction", junctionId: "j2" },
      bends: [],
      modes: ["manual"],
    }),
  );
  const routing = resolveDocumentRoutingGeometry(input.document, resolver);
  input.routeGeometryRecords = input.document.routes.flatMap((route) => {
    const geometry = routing.routes.get(route.id);
    return geometry ? [{ route, geometry }] : [];
  });
  return input;
}

describe("property edit planner", () => {
  it("retains an imported route label id and dragged anchor while renaming", () => {
    const input = routedFixture();
    input.document.annotations.push({
      id: "imported-label",
      kind: "net-label",
      netId: "net",
      anchor: {
        kind: "route",
        routeId: "route",
        legId: input.document.routes[0]!.legs[0]!.id,
        t: 0.8,
        normalOffset: 20,
        direction: "forward",
        orientation: "follow",
        fallbackPosition: { x: 80, y: 20 },
      },
      alignment: "end",
      rotation: 0,
      locked: false,
    });
    const planner = createPropertyEditPlanner(input);

    const edits = planner.netLabelEditsForRoute(
      input.document.routes[0]!,
      " SIGNAL ",
    );

    expect(edits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "upsert_schematic_annotation",
          annotation: expect.objectContaining({
            id: "imported-label",
            alignment: "end",
            anchor: expect.objectContaining({ t: 0.8, normalOffset: 20 }),
          }),
        }),
      ]),
    );
  });

  it("surfaces a rejected named-net plan on the status bar instead of failing silently", () => {
    const input = routedFixture();
    input.document.connectivityEvidence.push(
      {
        id: "claim-a",
        kind: "name-claim",
        netId: "net",
        name: "vdd",
        scope: "local",
        powerDomain: "vdd",
        owner: { kind: "net-label", annotationId: "test-net-label-1" },
      },
      {
        id: "claim-b",
        kind: "name-claim",
        netId: "net",
        name: "vdd",
        scope: "local",
        powerDomain: "ground",
        owner: { kind: "net-label", annotationId: "test-net-label-2" },
      },
    );
    const planner = createPropertyEditPlanner(input);
    const edits = planner.netLabelEditsForRoute(
      input.document.routes[0]!,
      "vdd",
    );
    expect(edits).toBeNull();
    expect(input.setStatus).toHaveBeenCalledWith(
      "Cannot join named Nets with incompatible power roles",
    );
  });

  it("reports an unresolved wire geometry instead of failing silently", () => {
    const input = routedFixture();
    input.routeGeometryRecords = [];
    const planner = createPropertyEditPlanner(input);
    const edits = planner.netLabelEditsForRoute(
      input.document.routes[0]!,
      "bias",
    );
    expect(edits).toBeNull();
    expect(input.setStatus).toHaveBeenCalledWith(
      "Net Label position could not be resolved for this wire",
    );
  });

  it("reports a stale Power Label binding without emitting edits", () => {
    const input = fixture();
    const annotation: Annotation = {
      id: "vdd-label",
      kind: "power-label",
      binding: { kind: "net-name", netId: "missing" },
      netId: "missing",
      anchor: {
        kind: "object",
        objectId: "V1",
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 0, y: -20 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    };
    const planner = createPropertyEditPlanner(input);

    expect(planner.netNameEditsForAnnotation(annotation, "VDD")).toBeNull();
    expect(input.setStatus).toHaveBeenCalledWith(
      "Net Label references missing Net missing",
    );
  });

  it("plans parameter patches, snapped movement, and rotation atomically", () => {
    const input = fixture();
    input.document.presentation.grid = 10;
    input.document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        reference: "R1",
        parameters: { value: "1k" },
      },
    });
    const planner = createPropertyEditPlanner(input);

    expect(
      planner.instancePropertyEdits({
        instanceId: "R1",
        parameters: { value: " 2k " },
        x: "24",
        y: "36",
        rotation: "90",
      }),
    ).toEqual({
      invalidPosition: false,
      edits: [
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "R1",
          set: { value: "2k" },
        },
        { kind: "move_instance", instanceId: "R1", position: { x: 20, y: 40 } },
        { kind: "rotate_instance", instanceId: "R1", rotation: 90 },
      ],
    });
  });

  it("flags an invalid position while retaining a valid rotation edit", () => {
    const input = fixture();
    input.document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
    });
    const planner = createPropertyEditPlanner(input);

    expect(
      planner.instancePropertyEdits({
        instanceId: "R1",
        parameters: {},
        x: "invalid",
        y: "0",
        rotation: "180",
      }),
    ).toMatchObject({
      invalidPosition: true,
      edits: [
        expect.objectContaining({ kind: "set_instance_netlist" }),
        { kind: "rotate_instance", instanceId: "R1", rotation: 180 },
      ],
    });
  });
});
