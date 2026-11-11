import { describe, expect, it } from "vitest";

import {
  executeProjectTransaction,
  executeTransaction,
} from "@icm/edit-engine";
import { createEmptyProject, flattenRichText, type Instance } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { planPropertyApply } from "./property-apply-plan";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("planPropertyApply", () => {
  it("refuses to show a component value until the value is valid, then shows it", () => {
    const project = createEmptyProject("value-display", "Value display");
    const document = project.documents[0]!;
    const instance: Instance = {
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: {},
      },
    };
    document.instances.push(instance);
    const context = { project, document, resolver, instance };
    const showValue = (parameters: Record<string, string>) =>
      planPropertyApply(context, {
        placement: null,
        appearance: { color: "auto" },
        display: { value: true },
        parameters,
      });

    expect(showValue({ value: "" })).toEqual({
      kind: "rejected",
      message: "Set a valid component value before enabling its display",
    });
    const shown = showValue({ value: "33k" });
    expect(shown.kind).toBe("edits");
    expect(JSON.stringify(shown)).toContain("instance-value-R1");
  });

  it("hides and shows a component's name label from display.visualAnnotation", () => {
    const project = createEmptyProject("name-display", "Name display");
    const document = project.documents[0]!;
    const instance: Instance = {
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    };
    document.instances.push(instance);
    document.annotations.push({
      id: "instance-label-R1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "R1" },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 25, y: 0 },
        fallbackPosition: { x: 125, y: 100 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const apply = (target: typeof document, visualAnnotation: boolean) => {
      const plan = planPropertyApply(
        {
          project: { ...project, documents: [target] },
          document: target,
          resolver,
          instance,
        },
        {
          placement: null,
          appearance: { color: "auto" },
          display: { visualAnnotation },
        },
      );
      if (plan.kind === "unchanged") return target;
      if (plan.kind !== "edits") throw new Error(JSON.stringify(plan));
      const result = executeTransaction(target, {
        transactionId: `name-${visualAnnotation}`,
        documentId: target.id,
        expectedRevision: target.revision,
        actor: { kind: "human", id: "test" },
        edits: plan.edits,
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
      return result.document;
    };
    const label = (target: typeof document) =>
      target.annotations.find(
        (annotation) => annotation.id === "instance-label-R1",
      );

    // Already shown: nothing to do.
    expect(apply(document, true)).toBe(document);
    const hidden = apply(document, false);
    expect(label(hidden)?.visible).toBe(false);
    const shown = apply(hidden, true);
    expect(shown).not.toBe(hidden);
    expect(label(shown)?.visible).not.toBe(false);
  });

  it("draws a UJT renamed Q3 by a display alias and keeps its X Reference", () => {
    const project = createEmptyProject("ujt-name", "UJT name");
    const document = project.documents[0]!;
    // Drawn before UJTs were drawn Q: its label still follows X1.
    const instance: Instance = {
      id: "ujt",
      reference: "X1",
      symbolId: "ujt",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      netlist: { parameters: {} },
    };
    document.instances.push(instance);
    document.annotations.push({
      id: "instance-label-ujt",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "ujt" },
      anchor: {
        kind: "object",
        objectId: "ujt",
        localOffset: { x: 25, y: 0 },
        fallbackPosition: { x: 125, y: 100 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const rename = (name: "displayName" | "netlistName", text: string) => {
      const plan = planPropertyApply(
        { project, document, resolver, instance },
        { placement: null, appearance: { color: "auto" }, [name]: text },
      );
      if (plan.kind !== "edits") throw new Error(JSON.stringify(plan));
      return plan.edits;
    };
    for (const name of ["displayName", "netlistName"] as const) {
      const edits = rename(name, "Q3");
      expect(edits.some((edit) => edit.kind === "set_instance_reference")).toBe(
        false,
      );
      const label = edits.find(
        (edit) => edit.kind === "upsert_schematic_annotation",
      );
      expect(label).toMatchObject({
        annotation: { id: "instance-label-ujt" },
      });
      if (label?.kind !== "upsert_schematic_annotation") throw new Error();
      expect(label.annotation.binding).toBeUndefined();
      expect(flattenRichText(label.annotation.content!)).toBe("Q3");
    }
    // An X name is still its Reference.
    expect(rename("netlistName", "X4")).toContainEqual({
      kind: "set_instance_reference",
      instanceId: "ujt",
      reference: "X4",
    });
  });

  it("renames a copied Cell Pin's formal name though it has no canvas label", () => {
    const project = createEmptyProject("pin-name", "Pin name");
    const document = project.documents[0]!;
    const instance: Instance = {
      id: "P2-copy-1",
      symbolId: "port",
      placement: { position: { x: 300, y: 200 }, rotation: 0, mirror: "none" },
    };
    document.instances.push(instance);
    document.nets.push({
      id: "net-voc",
      terminals: [{ instanceId: instance.id, pinName: "P" }],
    });
    document.netlist = {
      name: document.name,
      formalParameters: [],
      terminals: [
        {
          id: "terminal-voc",
          name: "Voc",
          netId: "net-voc",
          direction: "passive",
          interfaceInstanceIds: [instance.id],
        },
      ],
    };
    const plan = planPropertyApply(
      { project, document, resolver, instance },
      { placement: null, appearance: { color: "auto" }, displayName: "Vcm" },
    );
    if (plan.kind !== "structure") throw new Error(JSON.stringify(plan));
    const renamed = executeProjectTransaction(project, {
      transactionId: "rename-pin",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: plan.structureEdits,
    });
    if (!renamed.ok) throw new Error(JSON.stringify(renamed));
    const after = renamed.project.documents[0]!;
    expect(after.netlist!.terminals).toEqual([
      expect.objectContaining({
        id: "terminal-voc",
        name: "Vcm",
        netId: "net-voc",
      }),
    ]);
    expect(after.instances.map((item) => item.id)).toEqual(["P2-copy-1"]);
  });
});
