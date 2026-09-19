import { createRoutePath } from "@icm/model";
import { resolveDocumentRoutingGeometry } from "@icm/derived";
import { createEmptyProject } from "@icm/model";
import type { Annotation } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";

import { createPropertyEditPlanner } from "./property-edit-planner";
import {
  componentPropertyDetailsValue,
  componentDetailFields,
} from "./component-property-details";

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
  it.each(["subcircuit", "external-subcircuit"] as const)(
    "projects %s declarations without materializing inherited defaults",
    (kind) => {
      const input = fixture();
      const formalParameters = [
        { name: "Rbase", defaultValue: "1k" },
        { name: "gain" },
      ];
      const child = createEmptyProject("child-project", "Child").documents[0]!;
      child.id = "child";
      child.netlist = { name: "Child", terminals: [], formalParameters };
      input.project.documents.push(child);
      input.project.externalSubcircuitDefinitions.push({
        id: "external",
        interfaceStatus: "declared",
        name: "External",
        terminals: [],
        formalParameters,
      });
      const instance = {
        id: "X1",
        symbolId: "subcircuit:Child",
        reference: "X1",
        placement: {
          position: { x: 0, y: 0 },
          rotation: 0 as const,
          mirror: "none" as const,
        },
        netlist: {
          parameters: {} as Record<string, string>,
          binding:
            kind === "subcircuit"
              ? { kind, childDocumentId: child.id }
              : { kind, definitionId: "external" },
        },
      };
      input.document.instances.push(instance);
      const planner = createPropertyEditPlanner(input);
      const parameters = planner.propertyParametersForInstance(instance);
      expect(parameters.map((parameter) => parameter.key)).toEqual([
        "Rbase",
        "gain",
      ]);
      const context = { parameters };
      expect(
        componentPropertyDetailsValue(instance, context).parameters,
      ).toEqual({ Rbase: "", gain: "" });
      expect(componentDetailFields(instance, context)).toContainEqual(
        expect.objectContaining({
          path: "parameters.Rbase",
          description: "Default: 1k",
        }),
      );
      const draft = {
        instanceId: instance.id,
        parameters: { Rbase: "", gain: "" },
        x: "0",
        y: "0",
        rotation: "0" as const,
      };
      expect(planner.instancePropertyEdits(draft).edits).toEqual([]);
      expect(
        planner.instancePropertyEdits({
          ...draft,
          parameters: { Rbase: "2k", gain: "3" },
        }).edits,
      ).toEqual([
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "X1",
          set: { Rbase: "2k", gain: "3" },
        },
      ]);
      instance.netlist.parameters = { Rbase: "2k" };
      expect(planner.instancePropertyEdits(draft).edits).toEqual([
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "X1",
          unset: ["Rbase"],
        },
      ]);
      expect(child.netlist.formalParameters).toEqual(formalParameters);
      instance.netlist.parameters = { RBASE: "5k" };
      const importedParameters =
        planner.propertyParametersForInstance(instance);
      expect(
        componentPropertyDetailsValue(instance, {
          parameters: importedParameters,
        }).parameters,
      ).toEqual({ RBASE: "5k", gain: "" });
      expect(
        planner.instancePropertyEdits({
          ...draft,
          parameters: { RBASE: "", gain: "" },
        }).edits,
      ).toEqual([
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "X1",
          unset: ["RBASE"],
        },
      ]);
    },
  );

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

  it("commits the same route attachment resolved by the L-command preview", () => {
    const input = routedFixture();
    const planner = createPropertyEditPlanner(input);
    const legId = input.document.routes[0]!.legs[0]!.id;

    const edits = planner.netLabelEditsForRoute(
      input.document.routes[0]!,
      "SIGNAL",
      {
        alignment: "start",
        sizeScale: 1,
        position: { x: 70, y: -8 },
        routeAttachment: {
          routeId: "route",
          legId,
          t: 0.7,
          normalOffset: -8,
          direction: "forward",
        },
      },
    );

    expect(edits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "upsert_schematic_annotation",
          annotation: expect.objectContaining({
            id: "net-label-route",
            alignment: "start",
            anchor: {
              kind: "route",
              routeId: "route",
              legId,
              t: 0.7,
              normalOffset: -8,
              direction: "forward",
              orientation: "follow",
              fallbackPosition: { x: 70, y: -8 },
            },
          }),
        }),
      ]),
    );
  });

  it("renames a free L-command label without moving it back onto a Route", () => {
    const input = routedFixture();
    const annotation: Annotation = {
      id: "free-label",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net" },
      netId: "net",
      anchor: { kind: "free", position: { x: 70, y: 10 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    };
    input.document.annotations.push(annotation);
    input.document.connectivityEvidence.push({
      id: "claim-free-label",
      kind: "name-claim",
      netId: "net",
      name: "SIGNAL",
      scope: "local",
      owner: { kind: "net-label", annotationId: annotation.id },
    });
    const presentation = { ...annotation, sizeScale: 1.2 };
    const planner = createPropertyEditPlanner(input);

    const edits = planner.netNameEditsForAnnotation(
      annotation,
      "RENAMED",
      presentation,
    );

    expect(edits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "upsert_connectivity_evidence",
          evidence: expect.objectContaining({ name: "RENAMED" }),
        }),
        {
          kind: "upsert_schematic_annotation",
          annotation: presentation,
        },
      ]),
    );
    expect(presentation.anchor).toEqual({
      kind: "free",
      position: { x: 70, y: 10 },
    });
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

  it("changes only the selected Net Label owner's existing scope claim", () => {
    const input = routedFixture();
    const annotation: Annotation = {
      id: "label-vdd",
      kind: "net-label",
      binding: { kind: "net-name", netId: "net" },
      netId: "net",
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    };
    input.document.annotations.push(annotation);
    input.document.connectivityEvidence.push({
      id: "claim-vdd",
      kind: "name-claim",
      netId: "net",
      name: "VDD",
      scope: "local",
      owner: { kind: "net-label", annotationId: annotation.id },
    });
    const before = structuredClone(input.document);
    const planner = createPropertyEditPlanner(input);

    expect(planner.netLabelScopeEdit(annotation, "global")).toEqual([
      {
        kind: "upsert_connectivity_evidence",
        evidence: {
          id: "claim-vdd",
          kind: "name-claim",
          netId: "net",
          name: "VDD",
          scope: "global",
          owner: { kind: "net-label", annotationId: "label-vdd" },
        },
      },
    ]);
    expect(input.document).toEqual(before);
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
      reference: "R1",
      netlist: {
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
