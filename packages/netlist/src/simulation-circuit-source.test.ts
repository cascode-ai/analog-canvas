import { describe, expect, it } from "vitest";
import { CircuitProjectSchema } from "@icm/model";
import ota from "../../../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json";
import {
  generateCircuitSource,
  planCircuitSourceEdit,
  type GeneratedCircuitSource,
} from "./simulation-circuit-source.js";

function fixture() {
  const project = CircuitProjectSchema.parse(ota);
  const setup = project.simulationSetups.find(
    (s) => s.input.kind === "structured",
  )!;
  if (setup.input.kind !== "structured") throw Error("expected Canvas setup");
  const result = generateCircuitSource(project, {
    id: "b",
    path: "circuit.spice",
    documentId: setup.input.rootDocumentId,
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
    expect(project).toEqual(CircuitProjectSchema.parse(ota));
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
      planCircuitSourceEdit(source, replace(source, [{ index, text: "{W}" }])),
    ).toMatchObject({ ok: false, code: "SIMULATION_PARAMETER_INVALID" });
    expect(
      planCircuitSourceEdit(source, replace(source, [{ index, text: "25u" }])),
    ).toMatchObject({ ok: false, code: "SIMULATION_PARAMETER_INVALID" });
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
});
