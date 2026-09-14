import { describe, expect, it } from "vitest";
import { CircuitProjectSchema, createSimulationFolder } from "@icm/model";
import { currentFiveTransistorOtaCircuitSource } from "../../../apps/editor/src/examples/five-transistor-ota.test-support.js";
import { CapabilitiesSchema } from "./contract.js";
import { prepareSourceExecutionInput } from "./prepare-source.js";
import { locateSimulationText } from "@icm/netlist";

function fixture() {
  const project = CircuitProjectSchema.parse(
    currentFiveTransistorOtaCircuitSource(),
  );
  const folder = createSimulationFolder({
    id: "native-model",
    name: "Native",
    profileId: "candidate",
  });
  folder.input.entry = "tb/run.sim";
  folder.input.files = [
    {
      path: "experiment.json",
      text: JSON.stringify({
        version: 2,
        environment: { profileId: "candidate" },
      }),
    },
    {
      path: "tb/run.sim",
      text: 'Native model preparation\ninclude "../circuit.inc"\ncontrol\nanalysis bias op\nendc\n',
    },
  ];
  folder.input.circuitBindings = [
    {
      id: "binding",
      path: "circuit.inc",
      documentId: project.documents[0]!.id,
      emission: "subcircuit",
    },
  ];
  const caps = CapabilitiesSchema.parse({
    configured: true,
    rawfileCollection: "native-multi-ascii",
    inputs: ["source"],
    analyses: ["op", "dc", "ac", "tran", "noise"],
    parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
    maxInputFiles: 24,
    maxInputBytes: 1_048_576,
    maxOutputBytes: 1_048_576,
    maxTimeoutMs: 15_000,
    cancel: true,
    profiles: [
      {
        id: "candidate",
        corners: ["tt", "ff"],
        dependencies: [{ id: "models", sha256: "a".repeat(64) }],
        modelLibrary: { dependencyId: "models", defaultSection: "tt" },
      },
    ],
  });
  return { project, folder, caps };
}
describe("native model preparation", () => {
  it("applies the same Profile section contract to code-only programs without requiring a Canvas binding", async () => {
    const { project, folder, caps } = fixture();
    folder.input.circuitBindings = [];
    folder.input.dependencies = [
      { id: "models", sha256: "a".repeat(64), mountPath: "library.inc" },
    ];
    const entry = folder.input.files[1]!;
    entry.text =
      'Code-only model program\ninclude "../library.inc" section=ff\ncontrol\nanalysis bias op\nendc\n';
    const before = structuredClone(folder);
    const prepared = await prepareSourceExecutionInput(project, folder, caps);
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    if (prepared.ok) {
      expect(prepared.input.environment.corner).toBe("ff");
      expect(prepared.input.preparedDeck).toBe(entry.text);
      expect(prepared.generated).toEqual([]);
    }
    expect(folder).toEqual(before);
    entry.text = entry.text.replace("section=ff", "section=FF");
    expect(
      await prepareSourceExecutionInput(project, folder, caps),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_CORNER_UNSUPPORTED" },
    });
  });

  it("loads a profile-addressed native section and maps generated text without editing saved source", async () => {
    const { project, folder, caps } = fixture();
    const before = structuredClone({ project, folder });
    const prepared = await prepareSourceExecutionInput(project, folder, caps);
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.input).toMatchObject({
      language: "vacask",
      collection: { kind: "native-multi-ascii" },
      environment: { corner: "tt" },
      dependencies: [
        { id: "models", sha256: "a".repeat(64), mountPath: "icm-models.inc" },
      ],
    });
    expect(prepared.input.preparedDeck).toContain(
      'include "../icm-models.inc" section=tt',
    );
    expect(prepared.input.preparedDeck).not.toContain(".lib");
    const mapped = prepared.sourceMaps.find((m) => m.path === "tb/run.sim")!;
    expect(
      locateSimulationText(
        mapped,
        prepared.input.preparedDeck.indexOf("// Profile"),
      ),
    ).toMatchObject({ kind: "generated", purpose: "environment" });
    expect({ project, folder }).toEqual(before);
  });
  it("honors an explicit native section and never folds case or silently inserts a second include", async () => {
    const { project, folder, caps } = fixture();
    folder.input.dependencies = [
      { id: "models", sha256: "a".repeat(64), mountPath: "library.inc" },
    ];
    const entry = folder.input.files[1]!;
    entry.text = entry.text.replace(
      "\n",
      '\ninclude "../library.inc" section=ff\n',
    );
    const prepared = await prepareSourceExecutionInput(project, folder, caps);
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    if (prepared.ok) {
      expect(prepared.input.preparedDeck).toBe(entry.text);
      expect(prepared.input.environment.corner).toBe("ff");
    }
    entry.text = entry.text.replace("section=ff", "section=FF");
    expect(
      await prepareSourceExecutionInput(project, folder, caps),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_CORNER_UNSUPPORTED" },
    });
  });
  it("rejects mismatched dependencies and refuses a legacy executor without losing editable source", async () => {
    const { project, folder, caps } = fixture();
    const entry = folder.input.files[1]!.text;
    expect(
      await prepareSourceExecutionInput(project, folder, {
        ...caps,
        rawfileCollection: "declared-single-ascii",
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_NATIVE_RUNTIME_UNAVAILABLE",
        recovery: "retry-after",
      },
    });
    folder.input.dependencies = [
      { id: "models", sha256: "b".repeat(64), mountPath: "library.inc" },
    ];
    expect(
      await prepareSourceExecutionInput(project, folder, caps),
    ).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_COMPILE_REFUSED",
        diagnostics: [{ code: "SIMULATION_DEPENDENCY_UNAVAILABLE" }],
      },
    });
    expect(folder.input.files[1]!.text).toBe(entry);
  });
});
