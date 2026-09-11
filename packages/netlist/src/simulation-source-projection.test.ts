import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  LegacyProjectSimulationSetupSchema,
} from "@icm/model";
import { describe, expect, it } from "vitest";
import {
  CircuitProjectSchema,
  SimulationExperimentConfigSchema,
  type SimulationRunVariant,
  type ProjectSimulationFolder,
} from "@icm/model";
import ota from "../../../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json";
const legacySetups = () =>
  ota.simulationSetups.map((s) => LegacyProjectSimulationSetupSchema.parse(s));
import { migrateSimulationSetupToSource } from "./simulation-source-migration.js";
import { projectSourceSimulation } from "./simulation-source-projection.js";
import { inspectSimulationSourceGraph } from "./simulation-source-graph.js";
import { compileSourceSimulation } from "./simulation-source-compile.js";
import { locateSimulationText } from "./simulation-source-map.js";

function fixture() {
  const project = CircuitProjectSchema.parse({
    ...Object.fromEntries(
      Object.entries(ota).filter(([key]) => key !== "simulationSetups"),
    ),
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    simulationFolders: [],
  });
  const folder = migrateSimulationSetupToSource(
    project,
    legacySetups()[0]!,
  ).folder;
  const document = project.documents.find((d) =>
    d.instances.some((i) => i.netlist?.parameters.w),
  )!;
  const instance = document.instances.find((i) => i.netlist?.parameters.w)!;
  const target = {
    documentId: document.id,
    instanceId: instance.id,
    parameter: "w",
  };
  const configFile = folder.input.files.find(
    (f) => f.path === folder.input.configPath,
  )!;
  const config = SimulationExperimentConfigSchema.parse(
    JSON.parse(configFile.text),
  );
  config.variables = [
    { id: "base", name: "BASE", sourcePath: "bias.spice", bindings: [] },
    {
      id: "width",
      name: "WIDTH",
      sourcePath: "bias.spice",
      bindings: [target],
    },
  ];
  configFile.text = JSON.stringify(config);
  const entry = folder.input.files.find((f) => f.path === folder.input.entry)!;
  const end = entry.text.indexOf("\n") + 1;
  entry.text =
    entry.text.slice(0, end) +
    '.include "bias.spice"\n' +
    entry.text.slice(end);
  folder.input.files.push({
    path: "bias.spice",
    text: ".param BASE=10u $ BASE is the starting value\r\n+ WIDTH={BASE * 2}\r\n",
  });
  return { project, folder, config, document, target };
}
function projectPoint(
  f: ReturnType<typeof fixture>,
  variant?: SimulationRunVariant,
) {
  return projectSourceSimulation(
    f.project,
    f.folder,
    f.config,
    inspectSimulationSourceGraph(f.folder.input),
    variant,
  );
}

describe("native source run projection", () => {
  it("reports stale variable binding parameters without mutating the saved input", () => {
    const f = fixture();
    const instance = f.document.instances.find(
      (i) => i.id === f.target.instanceId,
    )!;
    delete instance.netlist!.parameters.w;
    const before = structuredClone(f.project);
    expect(projectPoint(f).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SIMULATION_VARIABLE_BINDING_PARAMETER_MISSING",
        }),
      ]),
    );
    expect(f.project).toEqual(before);
  });
  it("resolves nominal -> variable point -> exact instance point without mutating any saved input", () => {
    const f = fixture(),
      original = structuredClone(f);
    const nominal = projectPoint(f);
    expect(nominal.diagnostics).toEqual([]);
    const width = (p: typeof nominal.project) =>
      p.documents
        .find((d) => d.id === f.target.documentId)!
        .instances.find((i) => i.id === f.target.instanceId)!.netlist!
        .parameters.w;
    expect(Number(width(nominal.project))).toBeCloseTo(20e-6, 12);
    const point = projectPoint(f, {
      variables: [{ variableId: "base", value: "15u" }],
    });
    expect(point.diagnostics).toEqual([]);
    expect(Number(width(point.project))).toBeCloseTo(30e-6, 12);
    expect(point.mappedFiles.find((f) => f.path === "bias.spice")!.text).toBe(
      ".param BASE=15u $ BASE is the starting value\r\n+ WIDTH={BASE * 2}\r\n",
    );
    const exact = projectPoint(f, {
      variables: [{ variableId: "base", value: "15u" }],
      parameters: [{ ...f.target, value: "40u" }],
    });
    expect(exact.diagnostics).toEqual([]);
    expect(width(exact.project)).toBe("40u");
    expect(f).toEqual(original);
  });
  it("does not mistake unrelated local .param names for ambiguous root variables", () => {
    const f = fixture();
    f.folder.input.files.find((f) => f.path === "bias.spice")!.text +=
      ".subckt unrelated a b\n.param BASE=999\nR1 a b {BASE}\n.ends\n";
    const point = projectPoint(f, {
      variables: [{ variableId: "base", value: "11u" }],
    });
    expect(point.diagnostics).toEqual([]);
    expect(
      point.mappedFiles.find((f) => f.path === "bias.spice")!.text,
    ).toContain(".param BASE=999");
    f.document.netlist!.formalParameters.push({
      name: "WIDTH",
      defaultValue: "1u",
    });
    expect(projectPoint(f).diagnostics).toContainEqual(
      expect.objectContaining({ code: "SIMULATION_VARIABLE_SHADOWED" }),
    );
  });
  it.each([
    "duplicate",
    "conditional",
    "missing",
    "expression",
    "unknown-point",
    "repeated-point",
  ] as const)("reports a repairable managed variable error for %s", (type) => {
    const f = fixture(),
      file = f.folder.input.files.find((f) => f.path === "bias.spice")!;
    let points = [{ variableId: "base", value: "12u" }];
    if (type === "duplicate") file.text += ".param BASE=2u\n";
    if (type === "conditional") file.text = `.if (1)\n${file.text}.endif\n`;
    if (type === "missing") f.config.variables[0]!.sourcePath = "missing.spice";
    if (type === "expression") points[0]!.value = "unknown(123)";
    if (type === "unknown-point") points[0]!.variableId = "unknown";
    if (type === "repeated-point")
      points.push({ variableId: "base", value: "13u" });
    expect(
      projectPoint(f, { variables: points }).diagnostics.some(
        (d) => d.severity === "error",
      ),
    ).toBe(true);
    expect(f.project).toEqual(
      CircuitProjectSchema.parse({
        ...Object.fromEntries(
          Object.entries(ota).filter(([key]) => key !== "simulationSetups"),
        ),
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        simulationFolders: [],
      }),
    );
  });
  it("leaves unbound native expressions to ngspice and only requires finite values for managed projection", () => {
    const f = fixture();
    f.config.variables = [
      { id: "native", name: "NATIVE", sourcePath: "bias.spice", bindings: [] },
    ];
    f.folder.input.files.find((f) => f.path === "bias.spice")!.text +=
      ".param NATIVE={custom_function(3)}\n";
    expect(projectPoint(f).diagnostics).toEqual([]);
  });
  it.each(["27", "{20 + 7}", "'20 + 7'"])(
    "replaces .temp %s once, preserving source comments and later line mappings",
    (value) => {
      const f = fixture(),
        entry = f.folder.input.files.find(
          (file) => file.path === f.folder.input.entry,
        )!;
      entry.text = entry.text.replace(/^\.temp[^\n]*\n/gmu, "");
      f.folder.input.files.find((file) => file.path === "bias.spice")!.text +=
        `.temp ${value} $ nominal\r\n`;
      const point = projectPoint(f, {
        environment: { corner: "ss", temperatureC: -40 },
      });
      expect(point.diagnostics).toEqual([]);
      const mapped = point.mappedFiles.find((f) => f.path === "bias.spice")!;
      expect(mapped.text).toContain(".temp -40 $ nominal\r\n");
      expect(
        point.mappedFiles
          .map((f) => f.text)
          .join("\n")
          .match(/\.temp/gu),
      ).toHaveLength(1);
      expect(point.config.environment.corner).toBe("ss");
      expect(f.config.environment.corner).not.toBe("ss");
      expect(
        locateSimulationText(mapped, mapped.text.indexOf("-40")),
      ).toMatchObject({
        kind: "generated",
        purpose: "run-variant",
        nominal: { path: "bias.spice" },
      });
    },
  );
  it("only diagnoses competing .temp declarations when a managed point is requested", () => {
    const f = fixture();
    f.folder.input.files.find((f) => f.path === "bias.spice")!.text +=
      ".temp 0\n.temp 50\n";
    expect(projectPoint(f).diagnostics).toEqual([]);
    expect(
      projectPoint(f, { environment: { temperatureC: 125 } }).diagnostics,
    ).toContainEqual(
      expect.objectContaining({ code: "SIMULATION_TEMPERATURE_AMBIGUOUS" }),
    );
  });
  it("supports native-only temperature points and produces compilable mapped projections for OTA", () => {
    const f = fixture();
    const point = compileSourceSimulation(f.project, f.folder, {
      variables: [{ variableId: "base", value: "12u" }],
      environment: { temperatureC: 85 },
    });
    expect(point.ok, JSON.stringify(point.ok ? [] : point.diagnostics)).toBe(
      true,
    );
    if (!point.ok) return;
    expect(point.authoredFiles).toEqual(f.folder.input.files);
    const bias = point.files.find((f) => f.path === "bias.spice")!.text;
    expect(bias).toContain("BASE=12u");
    const sourceMap = point.sourceMaps.find((f) => f.path === "bias.spice")!;
    expect(locateSimulationText(sourceMap, bias.indexOf("12u"))).toMatchObject({
      purpose: "run-variant",
    });
    const native = structuredClone(f.folder) satisfies ProjectSimulationFolder;
    native.input.circuitBindings = [];
    const config = native.input.files.find(
      (file) => file.path === native.input.configPath,
    )!;
    config.text = JSON.stringify({
      version: 1,
      environment: { profileId: "native" },
    });
    native.input.files.find((file) => file.path === native.input.entry)!.text =
      "* native\r\nV1 a 0 1\r\n.control\r\nop\r\n.endc\r\n.end\r\n";
    const result = compileSourceSimulation(f.project, native, {
      environment: { temperatureC: 125 },
    });
    expect(
      result.ok &&
        result.files.find((file) => file.path === native.input.entry)!.text,
    ).toContain(".temp 125\nV1");
  });
});
