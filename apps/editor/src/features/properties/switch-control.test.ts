import { describe, expect, it } from "vitest";

import { executeTransaction } from "@icm/edit-engine";
import {
  createEmptyProject,
  type CircuitProject,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import {
  formatComponentPropertyCode,
  parseComponentPropertyCode,
} from "./component-property-code";
import { planPropertyApply } from "./property-apply-plan";
import { switchControlOf } from "./switch-control";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function part(id: string, symbolId: string, x: number): Instance {
  return {
    id,
    reference: id,
    symbolId,
    placement: { position: { x, y: 100 }, rotation: 0, mirror: "none" },
  };
}

/** One Open switch, both its pins No Connect, so the Cell exports alone. */
function switchCell() {
  const project = createEmptyProject("switch-control", "Switch control");
  const document = project.documents[0]!;
  document.instances.push({
    ...part("S1", "ideal-switch", 100),
    netlist: {
      binding: { kind: "primitive", deviceClass: "switch" },
      parameters: {},
    },
  });
  for (const pinName of ["1", "2"])
    document.noConnects.push({
      id: `nc-${pinName}`,
      endpoint: { kind: "terminal", instanceId: "S1", pinName },
    });
  return { project, document };
}

function apply(
  project: CircuitProject,
  document: SchematicDocument,
  switchControl: string | null,
  visualAnnotation?: boolean,
): SchematicDocument {
  const instance = document.instances.find((item) => item.id === "S1")!;
  const plan = planPropertyApply(
    {
      project: { ...project, documents: [document] },
      document,
      resolver,
      instance,
    },
    {
      placement: null,
      appearance: { color: "auto" },
      switchControl,
      ...(visualAnnotation !== undefined
        ? { display: { visualAnnotation } }
        : {}),
    },
  );
  if (plan.kind === "unchanged") return document;
  if (plan.kind !== "edits") throw new Error(JSON.stringify(plan));
  const result = executeTransaction(document, {
    transactionId: `control-${switchControl}-${visualAnnotation}`,
    documentId: document.id,
    expectedRevision: document.revision,
    actor: { kind: "human", id: "test" },
    edits: plan.edits,
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.document;
}

const label = (document: SchematicDocument) =>
  document.annotations.find(
    (annotation) =>
      annotation.kind === "instance-label" &&
      annotation.anchor.kind === "object" &&
      annotation.anchor.objectId === "S1",
  );

function controlNode(project: CircuitProject, document: SchematicDocument) {
  const exported = createDesignNetlistExport(
    { ...project, documents: [document] },
    { format: "spice" },
  );
  if (exported.status !== "ready")
    throw new Error(JSON.stringify(exported.diagnostics));
  return /^S1 \S+ \S+ (\S+) /mu.exec(exported.file.text)?.[1];
}

describe("a switch's control in Properties", () => {
  it("is offered only for a switch clocked by its label", () => {
    const { project, document } = switchCell();
    document.instances.push(
      part("R1", "resistor", 300),
      part("S2", "externally-controlled-switch", 500),
    );
    const of = (id: string) =>
      switchControlOf(
        project,
        document,
        document.instances.find((item) => item.id === id)!,
      );
    // No phase written: the switch is clocked by its own name.
    expect(of("S1")).toBeNull();
    expect(of("R1")).toBeUndefined();
    // A CTRL pin is wired, not named.
    expect(of("S2")).toBeUndefined();
  });

  it("writes the phase to a hidden label, which stays hidden and still clocks the switch", () => {
    const { project, document } = switchCell();
    expect(controlNode(project, document)).toBe("S1");

    const phased = apply(project, document, "Φ_A_bar", false);
    expect(label(phased)?.visible).toBe(false);
    expect(switchControlOf(project, phased, phased.instances[0]!)).toBe(
      "Φ_A_bar",
    );
    expect(controlNode(project, phased)).toBe("PHIA_bar");
    // The same phase again changes nothing.
    expect(apply(project, phased, "Φ_A_bar", false)).toBe(phased);
  });

  it("keeps a shown label shown, and null clocks the switch by its own name again", () => {
    const { project, document } = switchCell();
    const shown = apply(project, document, "Φ_1", true);
    expect(label(shown)?.visible).not.toBe(false);
    expect(controlNode(project, shown)).toBe("PHI1");

    const own = apply(project, shown, null);
    expect(switchControlOf(project, own, own.instances[0]!)).toBeNull();
    expect(label(own)?.visible).not.toBe(false);
    expect(controlNode(project, own)).toBe("S1");
  });

  it("reads and parses control in the Properties code", () => {
    const { document } = switchCell();
    const context = {
      instance: document.instances[0]!,
      referenceVisible: false,
      valueVisible: null,
      switchControl: null,
    };
    const code = formatComponentPropertyCode(context);
    expect(JSON.parse(code)).toMatchObject({ control: null });
    expect(code).not.toContain("displayName");

    const written = (control: unknown) =>
      parseComponentPropertyCode(
        JSON.stringify({ ...JSON.parse(code), control }),
        context,
      );
    expect(written(" Φ_A_bar ")).toMatchObject({
      ok: true,
      value: { switchControl: "Φ_A_bar" },
    });
    expect(written(null)).toMatchObject({
      ok: true,
      value: { switchControl: null },
    });
    expect(written(3)).toMatchObject({ ok: false });
    expect(written("")).toMatchObject({ ok: false });

    const resistor = {
      instance: part("R1", "resistor", 300),
      referenceVisible: true,
      valueVisible: null,
    };
    const resistorCode = JSON.parse(formatComponentPropertyCode(resistor));
    expect(resistorCode).not.toHaveProperty("control");
    expect(
      parseComponentPropertyCode(
        JSON.stringify({ ...resistorCode, control: "Φ_1" }),
        resistor,
      ),
    ).toMatchObject({ ok: false });
  });
});
