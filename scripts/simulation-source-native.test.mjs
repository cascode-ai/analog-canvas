import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import {
  ngspiceSimulationDevices as nativeSimulationDevices,
  ngspiceDeviceOpVectors as nativeDeviceOpVectors,
  generateCircuitSource,
  planCircuitSourceEdit,
} from "@icm/netlist";
import {
  prepareSourceExecutionInput,
  CAPABILITIES_ACCEPT_CELL_LIBRARIES,
  CapabilitiesSchema,
} from "@icm/simulation-service";
import { routeSimulationRequest } from "../worker/simulation.ts";
import {
  compileHostedSky130Project,
  compileHostedSky130TransientProject,
  compileHostedSky130NoiseProject,
  hostedSky130ExtendedDeviceRequest,
  hostedSky130HvtPfetRequest,
  profile,
} from "./lib/preview-simulation-qualification.mjs";
import {
  validateHostedSky130Result,
  validateHostedSky130TransientResult,
  validateHostedSky130NoiseResult,
  validateHostedSky130ExtendedDeviceResult,
  validateHostedSky130HvtPfetResult,
} from "./lib/preview-simulation-sky130-validation.mjs";
import { standardCellGates } from "../packages/simulation-service/test-support/standard-cell-gates.ts";

// This opt-in layer exercises the candidate image, not a mock or the shared Preview.
// container.yml always enables it before the operator-host rollout can occur.
const endpoint = process.env.ICM_SOURCE_ACCEPTANCE_URL;
if (
  endpoint &&
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname)
)
  throw Error(
    "Native image acceptance must target its isolated loopback container",
  );
const env = { SIMULATION_UPSTREAM_URL: endpoint };
/** The bound inverter's two transistors: drawn 0.65/0.15 and 1/0.15 µm. */
const CELL_SIZES = [
  "@m.x2.x0.msky130_fd_pr__nfet_01v8[w]",
  "@m.x2.x0.msky130_fd_pr__nfet_01v8[l]",
  "@m.x2.x1.msky130_fd_pr__pfet_01v8_hvt[w]",
];
const post = (body) =>
  routeSimulationRequest(
    new Request("http://acceptance/api/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );

async function run(request, name) {
  const response = await post(request);
  const payload = await response.json();
  await mkdir("test-results/source-native", { recursive: true });
  await writeFile(
    `test-results/source-native/${name}.json`,
    JSON.stringify(payload, null, 2),
  );
  expect(response.status, JSON.stringify(payload)).toBe(200);
  return payload;
}

describe.skipIf(!endpoint)("candidate ngspice46 source qualification", () => {
  it("executes edited AC clauses and preserves top-level Cell parameter defaults", async () => {
    const caps = CapabilitiesSchema.parse(
      await (await post({ operation: "capabilities" })).json(),
    );
    const project = parseProject(
      readFileSync(
        new URL(
          "../netlists/native-ota-library/legacy-source.icproj.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const root = project.documents.find(
      (cell) => cell.id === project.topDocumentId,
    );
    root.netlist.formalParameters.push({ name: "VBIAS", defaultValue: "1.8" });
    const folder = createSimulationFolder({
      id: "source-edits",
      engine: "ngspice",
      name: "Source edits",
      documentId: root.id,
      profileId: profile.id,
    });
    const generated = generateCircuitSource(
      project,
      folder.input.circuitBindings[0],
      folder.input,
      "ngspice",
    );
    expect(generated.ok).toBe(true);
    const body = generated.source.sourceBodies.find(
      (body) => body.instanceId === "VDD",
    );
    const plan = planCircuitSourceEdit(
      generated.source,
      generated.source.text.slice(0, body.startOffset) +
        " DC {VBIAS} AC 1 -90" +
        generated.source.text.slice(body.endOffset),
    );
    expect(plan.ok).toBe(true);
    for (const change of plan.changes)
      root.instances.find(
        (instance) => instance.id === change.instanceId,
      ).netlist.parameters[change.parameter] = change.value;
    const entry = folder.input.files.find(
      (file) => file.path === folder.input.entry,
    );
    entry.text =
      '* source parameters\n.include "circuit.spice"\n.control\nset filetype=ascii\nset appendwrite\nsave v(vdd)\nop\nwrite out.raw\nac lin 2 1k 2k\nwrite out.raw\n.endc\n.end\n';
    const prepared = await prepareSourceExecutionInput(project, folder, caps);
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    const result = await run(prepared.input, "source-parameters-default");
    expect(result.outcome.status, JSON.stringify(result)).toBe("completed");
    expect(
      result.data.analyses
        .find((a) => a.analysis === "op")
        .probes.find((p) => p.name === "v(vdd)").value,
    ).toBeCloseTo(1.8, 8);
    const ac = result.data.analyses
      .find((a) => a.analysis === "ac")
      .probes.find((p) => p.name === "v(vdd)");
    expect(ac.real[0]).toBeCloseTo(0, 8);
    expect(ac.imag[0]).toBeCloseTo(-1, 8);
    entry.text = entry.text.replace(".control", ".param VBIAS=1.7\n.control");
    const overridden = await prepareSourceExecutionInput(project, folder, caps);
    expect(overridden.ok, JSON.stringify(overridden)).toBe(true);
    const next = await run(overridden.input, "source-parameters-override");
    expect(next.outcome.status, JSON.stringify(next)).toBe("completed");
    expect(
      next.data.analyses
        .find((a) => a.analysis === "op")
        .probes.find((p) => p.name === "v(vdd)").value,
    ).toBeCloseTo(1.7, 8);
  }, 160_000);
  it("reads the reviewed SKY130 wrapper's native OP parameters", async () => {
    const circuit = parseProject(
      readFileSync(
        new URL(
          "../netlists/native-ota-library/legacy-source.icproj.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const folder = createSimulationFolder({
      id: "native-sky130",
      engine: "ngspice",
      name: "Native SKY130",
      profileId: profile.id,
      documentId: "document-ota-5t-testbench",
    });
    const devices = nativeSimulationDevices(circuit, folder.input).filter(
      (device) => device.polarity,
    );
    // The fixture includes the five-transistor core plus its bias device XM6.
    expect(devices.map((device) => device.reference).sort()).toEqual([
      "xdut.xm1",
      "xdut.xm2",
      "xdut.xm3",
      "xdut.xm4",
      "xdut.xm5",
      "xdut.xm6",
    ]);
    const entry = folder.input.files.find(
      (file) => file.path === folder.input.entry,
    );
    entry.text = entry.text.replace(
      "\nop\n",
      `\nsave ${devices.flatMap(nativeDeviceOpVectors).join(" ")}\nop\n`,
    );
    const response = await post({ operation: "capabilities" });
    const compiled = await prepareSourceExecutionInput(
      circuit,
      folder,
      CapabilitiesSchema.parse(await response.json()),
    );
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    const result = await run(compiled.input, "native-sky130-op");
    expect(result.outcome.status, JSON.stringify(result)).toBe("completed");
    const probes = result.data.analyses.find(
      (analysis) => analysis.analysis === "op",
    ).probes;
    // Acquisition availability/identity, not a new electrical golden or an
    // invented threshold. Numeric OTA qualification remains the existing tests.
    for (const vector of devices.flatMap(nativeDeviceOpVectors)) {
      const probe = probes.find((candidate) =>
        [vector, `i(${vector})`, `v(${vector})`].includes(candidate.name),
      );
      expect(probe, vector).toBeDefined();
      expect(Number.isFinite(probe.value), vector).toBe(true);
    }
  }, 160_000);
  it("collects native hierarchical Device OP and top-level terminal probes", async () => {
    const response = await post({ operation: "capabilities" });
    const caps = CapabilitiesSchema.parse(await response.json());
    const folder = createSimulationFolder({
      id: "native-device",
      engine: "ngspice",
      name: "Native device",
      profileId: profile.id,
    });
    folder.input.files.find((file) => file.path === folder.input.entry).text = [
      "Native naming contract; illustrative MOS1, not a PDK qualification",
      ".model NM NMOS level=1 vto=0.5 kp=100u",
      "V1 d 0 1",
      "V2 g 0 1",
      "R1 d 0 1k",
      "X1 d g inner",
      ".subckt inner d g",
      "M2 d g 0 0 NM w=10u l=1u",
      ".ends",
      ".probe i(r1,2)",
      ".control",
      "set filetype=ascii",
      "save @m.x1.m2[id] @m.x1.m2[gm] @m.x1.m2[vgs]",
      "op",
      "write native.raw",
      ".endc",
      ".end",
      "",
    ].join("\n");
    const compiled = await prepareSourceExecutionInput(
      createEmptyProject("native-device", "Native"),
      folder,
      caps,
    );
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    const result = await run(compiled.input, "native-device");
    expect(result.outcome.status, JSON.stringify(result)).toBe("completed");
    const probes = result.data.analyses.find(
      (analysis) => analysis.analysis === "op",
    ).probes;
    expect(
      probes.find((probe) => probe.name === "i(@m.x1.m2[id])").value,
    ).toBeCloseTo(0.000125, 8);
    expect(
      probes.find((probe) => probe.name === "@m.x1.m2[gm]").value,
    ).toBeCloseTo(0.0005, 8);
    expect(
      probes.find((probe) => probe.name === "v(@m.x1.m2[vgs])").value,
    ).toBeCloseTo(1, 8);
    expect(probes.find((probe) => probe.name === "i(r1:n2)").value).toBeCloseTo(
      -0.001,
      8,
    );
  });
  for (const [name, compile, validate] of [
    ["ota-op-dc-ac", compileHostedSky130Project, validateHostedSky130Result],
    [
      "ota-tran",
      compileHostedSky130TransientProject,
      validateHostedSky130TransientResult,
    ],
    [
      "ota-noise",
      compileHostedSky130NoiseProject,
      validateHostedSky130NoiseResult,
    ],
  ]) {
    it(
      name,
      async () => {
        const compiled = await compile();
        const result = await run(compiled.request, name);
        validate(
          result,
          "operator-host",
          compiled.input.inputRevision,
          compiled.vectors,
          compiled.request,
        );
      },
      160_000,
    );
  }

  it("solves the extended devices and the HD cells' high-Vt PFET at every corner", async () => {
    for (const corner of profile.qualifiedScope.sections) {
      validateHostedSky130ExtendedDeviceResult(
        await run(
          hostedSky130ExtendedDeviceRequest(corner),
          `extended-devices-${corner}`,
        ),
        "operator-host",
        corner,
      );
      validateHostedSky130HvtPfetResult(
        await run(hostedSky130HvtPfetRequest(corner), `hvt-pfet-${corner}`),
        "operator-host",
        corner,
      );
    }
  }, 160_000);

  it("simulates Library gates bound to SKY130 HD standard cells (#1596)", async () => {
    const caps = CapabilitiesSchema.parse(
      await (
        await post({
          operation: "capabilities",
          accepts: [CAPABILITIES_ACCEPT_CELL_LIBRARIES],
        })
      ).json(),
    );
    const { project, folder, entry } = standardCellGates(profile.id);
    // The drawing names its nets; read them off the cells' calls, which
    // also pins the cells' own pin order: A [B] VGND VNB VPB VPWR Y.
    const draft = await prepareSourceExecutionInput(project, folder, caps);
    expect(draft.ok, JSON.stringify(draft)).toBe(true);
    const circuit = draft.input.files.find(
      (file) => file.path === "circuit.spice",
    ).text;
    const nor =
      /^X1 (\S+) (\S+) 0 0 VDD VDD (\S+) sky130_fd_sc_hd__nor2_1$/mu.exec(
        circuit,
      );
    const inv = /^X2 (\S+) 0 0 VDD VDD (\S+) sky130_fd_sc_hd__inv_1$/mu.exec(
      circuit,
    );
    const nand =
      /^X3 (\S+) (\S+) 0 0 VDD VDD (\S+) sky130_fd_sc_hd__nand2_1$/mu.exec(
        circuit,
      );
    expect(nor, circuit).not.toBeNull();
    expect(inv, circuit).not.toBeNull();
    expect(nand, circuit).not.toBeNull();
    const [, a, b, y] = nor;
    const [, invIn, yi] = inv;
    const [, nandA, nandB, yn] = nand;
    expect([invIn, nandA, nandB]).toEqual([a, a, b]);
    entry.text = [
      "* NOR2 and NAND2 truth tables and inverter transfer, HD cells",
      '.include "circuit.spice"',
      "VDD VDD 0 1.8",
      `VA ${a} 0 0`,
      `VB ${b} 0 0`,
      ".control",
      "set filetype=ascii",
      "set appendwrite",
      // The cells give W and L in scaled units (w=650000u): only the
      // continuous library's scale=1.0u makes them the drawn microns.
      `save all ${CELL_SIZES.join(" ")}`,
      "op",
      "write out.raw",
      "alter VA dc=1.8",
      "op",
      "write out.raw",
      "alter VB dc=1.8",
      "op",
      "write out.raw",
      "alter VA dc=0",
      "op",
      "write out.raw",
      "alter VB dc=0",
      "dc VA 0 1.8 0.05",
      "write out.raw",
      ".endc",
      ".end",
      "",
    ].join("\n");
    const prepared = await prepareSourceExecutionInput(project, folder, caps);
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    expect(prepared.input.dependencies.map((d) => d.id)).toEqual([
      "sky130A-continuous",
      "sky130_fd_sc_hd",
    ]);
    const result = await run(prepared.input, "standard-cell-gates");
    expect(result.outcome.status, JSON.stringify(result)).toBe("completed");
    const value = (analysis, name) =>
      analysis.probes.find((probe) => probe.name === `v(${name})`).value;
    const ops = result.data.analyses.filter((item) => item.analysis === "op");
    // A device parameter comes back as the vector ngspice names v(@…).
    const size = (name) =>
      ops[0].probes.find((probe) => probe.name === `v(${name})`)?.value;
    expect(CELL_SIZES.map(size)).toEqual([
      expect.closeTo(0.65e-6, 12),
      expect.closeTo(0.15e-6, 12),
      expect.closeTo(1e-6, 12),
    ]);
    // (A, B) = (0, 0), (1, 0), (1, 1), (0, 1): only both low drives Y high.
    expect(ops.map((op) => value(op, y) > 1.7)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    for (const op of ops.slice(1)) expect(value(op, y)).toBeLessThan(0.1);
    expect(ops.map((op) => value(op, yn) > 1.7)).toEqual([
      true,
      true,
      false,
      true,
    ]);
    expect(value(ops[2], yn)).toBeLessThan(0.1);
    expect(ops.map((op) => value(op, yi) > 1.7)).toEqual([
      true,
      false,
      false,
      true,
    ]);
    const dc = result.data.analyses.find((item) => item.analysis === "dc");
    const input = dc.sweep.values;
    const output = value(dc, yi);
    expect(output[0]).toBeGreaterThan(1.79);
    expect(output.at(-1)).toBeLessThan(0.01);
    // Falls through the whole sweep, crossing mid-rail once.
    for (let index = 1; index < output.length; index++)
      expect(output[index]).toBeLessThanOrEqual(output[index - 1] + 1e-6);
    const crossing = output.findIndex((volts) => volts < 0.9);
    expect(input[crossing]).toBeGreaterThan(0.6);
    expect(input[crossing]).toBeLessThan(1.1);
    // The NOR with B low inverts A as well.
    expect(value(dc, y)[0]).toBeGreaterThan(1.79);
    expect(value(dc, y).at(-1)).toBeLessThan(0.01);
  }, 160_000);

  it("keeps repeated native records and recovers after an engine error", async () => {
    const response = await post({ operation: "capabilities" });
    const caps = CapabilitiesSchema.parse(await response.json());
    const folder = createSimulationFolder({
      id: "native",
      name: "Native records",
      profileId: profile.id,
    });
    const entry = folder.input.files.find(
      (file) => file.path === folder.input.entry,
    );
    entry.text = [
      "* native records",
      '.lib "sections.spice" tt',
      ".control",
      "set filetype=ascii",
      "set appendwrite",
      "op",
      "write out.raw",
      "alter V1=2",
      "op",
      "write out.raw",
      ".endc",
      ".end",
      "",
    ].join("\n");
    folder.input.files.push({
      path: "sections.spice",
      text: ".lib tt\nV1 in 0 1\nR1 in out 1k\nR2 out 0 1k\n.endl tt\n.lib unused\nV1 in 0 99\n.endl unused\n",
    });
    const project = createEmptyProject(
      "native-acceptance",
      "Native acceptance",
      "main",
    );
    const compiled = await prepareSourceExecutionInput(project, folder, caps);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    const result = await run(compiled.input, "native-records");
    expect(result.outcome.status, JSON.stringify(result)).toBe("completed");
    const ops = result.data.analyses.filter(
      (analysis) => analysis.analysis === "op",
    );
    expect(ops).toHaveLength(2);
    const values = ops.map(
      (op) => op.probes.find((probe) => probe.name === "v(out)").value,
    );
    expect(values[0]).toBeCloseTo(0.5, 9);
    expect(values[1]).toBeCloseTo(1, 9);

    // ngspice46 preloads includes even in an unselected .lib section. Preserve
    // that native error rather than claiming the inspector executes the language.
    const missingInclude = structuredClone(compiled.input);
    missingInclude.files.find((file) => file.path === "sections.spice").text +=
      ".lib absent\n.include missing.spice\n.endl absent\n";
    const missingResult = await run(
      missingInclude,
      "native-unselected-include",
    );
    expect(missingResult.outcome.status).toBe("failed");
    expect(missingResult.log).toContain(
      "Could not find include file missing.spice",
    );

    entry.text =
      "* missing model\nD1 n 0 MODEL_DOES_NOT_EXIST\nV1 n 0 1\n.control\nop\nwrite out.raw\n.endc\n.end\n";
    const bad = await prepareSourceExecutionInput(project, folder, caps);
    expect(bad.ok).toBe(true);
    expect(
      (await run(bad.input, "recoverable-model-error")).outcome.status,
    ).toBe("failed");
    expect(
      (await run(compiled.input, "repaired-native-records")).outcome.status,
    ).toBe("completed");
  }, 160_000);
});
