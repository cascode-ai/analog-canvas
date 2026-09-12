import { LegacyProjectSimulationSetupSchema } from "@icm/model";
import { describe, expect, it } from "vitest";
import { CircuitProjectSchema } from "@icm/model";
import {
  currentFiveTransistorOtaCircuitSource,
  legacyFiveTransistorOta as ota,
} from "../../../apps/editor/src/examples/five-transistor-ota.test-support.js";
import { analyzeDesignNetlist } from "./extract.js";
const legacySetups = () =>
  ota.simulationSetups.map((s) => LegacyProjectSimulationSetupSchema.parse(s));
import {
  generateCircuitSource,
  planCircuitSourceEdit,
  type GeneratedCircuitSource,
} from "./simulation-circuit-source.js";

function fixture() {
  const project = CircuitProjectSchema.parse(
    currentFiveTransistorOtaCircuitSource(),
  );
  const folder = legacySetups().find((s) => s.input.kind === "structured")!;
  if (folder.input.kind !== "structured") throw Error("expected Canvas folder");
  const result = generateCircuitSource(project, {
    id: "b",
    path: "circuit.spice",
    documentId: folder.input.rootDocumentId,
    emission: "top-level",
  });
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return { project, source: result.source };
}
function replace(
  source: GeneratedCircuitSource,
  edits: { index: number; text: string }[],
) {
  let text = source.text;
  for (const edit of [...edits].sort((a, b) => b.index - a.index)) {
    const span = source.parameters[edit.index]!;
    text =
      text.slice(0, span.startOffset) + edit.text + text.slice(span.endOffset);
  }
  return text;
}
describe("Circuit parameter source projection", () => {
  it("adds, changes and removes AC/phase and waveforms while keeping source nodes locked", () => {
    const { project, source } = fixture();
    const body = source.sourceBodies!.find(
      (body) => body.instanceId === "VDD",
    )!;
    const edit = (suffix: string) =>
      planCircuitSourceEdit(
        source,
        source.text.slice(0, body.startOffset) +
          suffix +
          source.text.slice(body.endOffset),
      );
    const plan = edit(" DC {BIAS} AC 1 -90 SIN(0 1 1k)");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ parameter: "acMagnitude", value: "1" }),
        expect.objectContaining({ parameter: "acPhase", value: "-90" }),
        expect.objectContaining({ parameter: "waveform", value: "sin" }),
      ]),
    );
    const instance = project.documents
      .find((d) => d.id === body.documentId)!
      .instances.find((i) => i.id === body.instanceId)!;
    plan.changes.forEach((change) => {
      instance.netlist!.parameters[change.parameter] = change.value;
    });
    const regenerated = generateCircuitSource(project, source.binding);
    expect(regenerated.ok).toBe(true);
    if (!regenerated.ok) return;
    expect(regenerated.source.text).toContain(
      "DC {BIAS} AC 1 -90 SIN(0 1 1k 0 0 0)",
    );
    const nextBody = regenerated.source.sourceBodies!.find(
      (b) => b.instanceId === "VDD",
    )!;
    const removed = planCircuitSourceEdit(
      regenerated.source,
      regenerated.source.text.slice(0, nextBody.startOffset) +
        " DC 1.8" +
        regenerated.source.text.slice(nextBody.endOffset),
    );
    expect(removed).toMatchObject({
      ok: true,
      changes: expect.arrayContaining([
        expect.objectContaining({ parameter: "acMagnitude", unset: true }),
        expect.objectContaining({ parameter: "acPhase", unset: true }),
        expect.objectContaining({ parameter: "waveform", value: "dc" }),
      ]),
    });
    expect(
      planCircuitSourceEdit(
        source,
        source.text.replace("VDD vdd 0", "VDD changed 0"),
      ),
    ).toMatchObject({ ok: false, code: "SIMULATION_CIRCUIT_STRUCTURE_LOCKED" });
    expect(edit(" DC 1.8 AC")).toMatchObject({
      ok: false,
      code: "SIMULATION_PARAMETER_INVALID",
    });
  });
  it("prints an unresolved model slot without crashing or assigning a model", () => {
    const { project, source } = fixture();
    const width = source.parameters.find((p) => p.parameter === "w")!;
    const instance = project.documents
      .find((d) => d.id === width.documentId)!
      .instances.find((i) => i.id === width.instanceId)!;
    instance.netlist = { parameters: {} };
    const before = JSON.stringify(project);
    const result = generateCircuitSource(project, source.binding);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.text).toContain("<model>");
    expect(result.warnings.some((d) => d.severity === "error")).toBe(true);
    expect(planCircuitSourceEdit(result.source, result.source.text)).toEqual({
      ok: true,
      changes: [],
    });
    expect(
      planCircuitSourceEdit(
        result.source,
        result.source.text.replace("<model>", "invented_model"),
      ),
    ).toMatchObject({ ok: false, code: "SIMULATION_CIRCUIT_STRUCTURE_LOCKED" });
    expect(
      analyzeDesignNetlist(project, {
        rootDocumentId: source.binding.documentId,
      }).ir,
    ).toBeNull();
    expect(JSON.stringify(project)).toBe(before);
  });
  it("keeps incomplete circuits editable without inventing defaults or relaxing export", () => {
    const { project, source } = fixture();
    const width = source.parameters.find((p) => p.parameter === "w")!;
    const instance = project.documents
      .find((d) => d.id === width.documentId)!
      .instances.find((i) => i.id === width.instanceId)!;
    delete instance.netlist!.parameters.w;
    delete instance.netlist!.parameters.l;
    const result = generateCircuitSource(project, source.binding);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const index = result.source.parameters.findIndex(
      (p) => p.instanceId === width.instanceId && p.parameter === "w",
    );
    expect(result.source.parameters[index]!.rawValue).toBe("<w>");
    expect(planCircuitSourceEdit(result.source, result.source.text)).toEqual({
      ok: true,
      changes: [],
    });
    expect(
      planCircuitSourceEdit(
        result.source,
        replace(result.source, [{ index, text: "20" }]),
      ),
    ).toMatchObject({
      ok: true,
      changes: [{ instanceId: width.instanceId, parameter: "w", value: "20u" }],
    });
    expect(instance.netlist!.parameters.w).toBeUndefined();
    const capacitance = source.parameters.find((p) => p.parameter === "value")!;
    const capacitor = project.documents
      .find((d) => d.id === capacitance.documentId)!
      .instances.find((i) => i.id === capacitance.instanceId)!;
    delete capacitor.netlist!.parameters.value;
    expect(generateCircuitSource(project, source.binding).ok).toBe(true);
    expect(
      analyzeDesignNetlist(project, {
        rootDocumentId: source.binding.documentId,
      }).ir,
    ).toBeNull();
  });
  it("maps all printed instance cards, including a parameterless DUT call, to Canvas identities", () => {
    const { source } = fixture();
    const dut = source.instances.find((card) => card.instanceId === "XDUT");
    expect(dut).toBeDefined();
    expect(source.text.slice(dut!.startOffset, dut!.endOffset)).toMatch(
      /^XDUT\s/i,
    );
    for (const parameter of source.parameters) {
      expect(
        source.instances.some(
          (card) =>
            card.documentId === parameter.documentId &&
            card.instanceId === parameter.instanceId &&
            card.startOffset <= parameter.startOffset &&
            card.endOffset >= parameter.endOffset,
        ),
      ).toBe(true);
    }
  });
  it("locates persisted numeric parameters and maps reviewed micrometres back to canonical SI", () => {
    const { project, source } = fixture();
    expect(planCircuitSourceEdit(source, source.text)).toEqual({
      ok: true,
      changes: [],
    });
    const index = source.parameters.findIndex(
      (p) => p.parameter === "w" && p.conversion === "sky130-micrometres",
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const plan = planCircuitSourceEdit(
      source,
      replace(source, [{ index, text: "25" }]),
    );
    expect(plan).toMatchObject({
      ok: true,
      changes: [
        {
          documentId: source.parameters[index]!.documentId,
          instanceId: source.parameters[index]!.instanceId,
          parameter: "w",
          value: "25u",
        },
      ],
    });
    expect(project).toEqual(
      CircuitProjectSchema.parse(currentFiveTransistorOtaCircuitSource()),
    );
    for (const span of source.parameters)
      expect(source.text.slice(span.startOffset, span.endOffset)).toBe(
        span.rawValue,
      );
  });
  it("rejects a mixed parameter and topology paste atomically", () => {
    const { source } = fixture();
    const index = source.parameters.findIndex((p) => p.parameter === "w");
    const changed = replace(source, [{ index, text: "25" }]).replace(
      ".subckt",
      ".subckt changed",
    );
    expect(planCircuitSourceEdit(source, changed)).toMatchObject({
      ok: false,
      code: "SIMULATION_CIRCUIT_STRUCTURE_LOCKED",
    });
    expect(
      planCircuitSourceEdit(source, replace(source, [{ index, text: "-1" }])),
    ).toMatchObject({ ok: false, code: "SIMULATION_PARAMETER_INVALID" });
    expect(
      planCircuitSourceEdit(source, replace(source, [{ index, text: "{W+}" }])),
    ).toMatchObject({ ok: false, code: "SIMULATION_PARAMETER_INVALID" });
    expect(
      planCircuitSourceEdit(source, replace(source, [{ index, text: "25u" }])),
    ).toMatchObject({ ok: false, code: "SIMULATION_PARAMETER_INVALID" });
    expect(
      planCircuitSourceEdit(
        source,
        replace(source, [{ index, text: "bad-value" }]) + "Rnew n1 0 1k\n",
      ),
    ).toMatchObject({ ok: false, code: "SIMULATION_CIRCUIT_STRUCTURE_LOCKED" });
  });
  it("accepts multiple numeric edits with shifting text offsets in one plan", () => {
    const { source } = fixture();
    const widths = source.parameters
      .flatMap((p, index) =>
        p.parameter === "w" ? [{ index, text: "123.5" }] : [],
      )
      .slice(0, 2);
    const plan = planCircuitSourceEdit(source, replace(source, widths));
    expect(plan.ok && plan.changes.length).toBe(2);
  });
  it("round-trips native parameter references through Canvas and reviewed PDK units", () => {
    const { project, source } = fixture();
    const index = source.parameters.findIndex((p) => p.parameter === "w");
    const edited = replace(source, [{ index, text: "{WIDTH * 2}" }]);
    const plan = planCircuitSourceEdit(source, edited);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changes[0]!.value).toBe("{(WIDTH * 2) * 1u}");
    for (const change of plan.changes)
      project.documents
        .find((d) => d.id === change.documentId)!
        .instances.find((i) => i.id === change.instanceId)!.netlist!.parameters[
        change.parameter
      ] = change.value;
    const regenerated = generateCircuitSource(project, source.binding);
    expect(regenerated.ok).toBe(true);
    if (!regenerated.ok) return;
    expect(regenerated.source.text).toBe(edited);
    expect(planCircuitSourceEdit(regenerated.source, edited)).toEqual({
      ok: true,
      changes: [],
    });
    const exported = analyzeDesignNetlist(project, {
      rootDocumentId: source.binding.documentId,
    });
    expect(exported.ir).not.toBeNull();
  });
  it.each(["{}", "{W", "{W;quit}", "{W}\nRnew out 0 1", "{W) + 1}"])(
    "does not let an expression escape its Circuit slot: %s",
    (text) => {
      const { source } = fixture();
      const index = source.parameters.findIndex((p) => p.parameter === "w");
      expect(
        planCircuitSourceEdit(source, replace(source, [{ index, text }])).ok,
      ).toBe(false);
    },
  );
});
