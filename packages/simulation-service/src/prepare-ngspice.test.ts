import { describe, expect, it } from "vitest";
import {
  CircuitProjectSchema,
  createSimulationFolder,
  createEmptyProject,
} from "@icm/model";
import {
  executeProjectTransaction,
  createExternalSubcircuitInstance,
  planSetDeviceModelTarget,
} from "../../edit-engine/src/index.js";
import { currentFiveTransistorOtaCircuitSource } from "../../../apps/editor/src/examples/five-transistor-ota.test-support.js";
import { locateSimulationText, createDesignNetlistExport } from "@icm/netlist";
import {
  createSimulationInputMetadata,
  isRawMultiFileTestbench,
} from "@icm/spice-run";
import { CapabilitiesSchema } from "./contract.js";
import { ProjectInputIdentity } from "./input-identity.js";
import { prepareNgspiceExecutionInput } from "./prepare-ngspice.js";
import { standardCellGates } from "../test-support/standard-cell-gates.js";
import hostedSky130 from "../../../containers/ngspice/hosted-sky130-profile.json";

function nativeSweepFixture() {
  const project = CircuitProjectSchema.parse(
    currentFiveTransistorOtaCircuitSource(),
  );
  const folder = createSimulationFolder({
    id: "native-sweep",
    name: "Native sweep",
    profileId: "ngspice",
    engine: "ngspice",
    documentId: project.topDocumentId,
  });
  folder.input.dependencies = [
    { id: "models", sha256: "a".repeat(64), mountPath: "models.lib" },
  ];
  const entry = folder.input.files.find(
    (file) => file.path === folder.input.entry,
  )!;
  entry.text = entry.text.replace(
    '.include "circuit.spice"',
    '.temp 27\n.lib "models.lib" ss\n.param BIAS=0.9\n.include "circuit.spice"',
  );
  project.simulationFolders = [folder];
  const caps = CapabilitiesSchema.parse({
    configured: true,
    rawfileCollection: "declared-single-ascii",
    inputs: ["source"],
    analyses: ["op"],
    parsedAnalyses: ["op"],
    profiles: [
      {
        id: "ngspice",
        corners: ["tt", "ff", "ss"],
        dependencies: [{ id: "models", sha256: "a".repeat(64) }],
      },
    ],
    modelLibrary: { path: "models.lib", section: "tt" },
    maxInputBytes: 2 * 1024 * 1024,
    maxOutputBytes: 1024 * 1024,
    maxTimeoutMs: 15000,
    cancel: true,
  });
  return { project, folder, entry, caps };
}

describe("ngspice authored input identity", () => {
  it("accepts mixed reviewed processes when every real library and call is qualified", async () => {
    const project = createEmptyProject("mixed-process", "Mixed process");
    const deps = [
      { id: "sky", mountPath: "sky.lib", sha256: "a".repeat(64) },
      { id: "ihp", mountPath: "ihp.lib", sha256: "b".repeat(64) },
    ];
    const applied = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "mixed",
      actor: { kind: "agent", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "owner",
            revision: 0,
            language: "spice",
            entry: "mixed.spice",
            dependencies: deps,
            files: [
              {
                path: "mixed.spice",
                text: '.lib "sky.lib" tt\n.lib "ihp.lib" tt\n.subckt mixed\nX1 d g s b sky130_fd_pr__nfet_01v8 w=1 l=0.15\nX2 d g s b sg13_lv_nmos w=1u l=130n\n.ends mixed\n',
              },
            ],
          },
          definitions: [{ definitionId: "mixed", entry: "mixed" }],
        },
      ],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const next = applied.project;
    next.documents[0]!.instances.push(
      createExternalSubcircuitInstance(
        "XTOP",
        next.externalSubcircuitDefinitions[0]!,
        { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      ),
    );
    const folder = createSimulationFolder({
      id: "mixed",
      name: "Mixed",
      profileId: "ngspice",
      engine: "ngspice",
      documentId: next.topDocumentId,
    });
    next.simulationFolders = [folder];
    const caps = nativeSweepFixture().caps;
    caps.profiles[0]!.devices = ["sky130_fd_pr__nfet_01v8", "sg13_lv_nmos"];
    caps.profiles[0]!.dependencies = deps.map(({ id, sha256 }) => ({
      id,
      sha256,
    }));
    const result = await prepareNgspiceExecutionInput(next, folder, caps);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.input.dependencies).toEqual(deps);
  });
  it.each([
    true,
    false,
    undefined,
    "local-primitive-shadow",
    "local-self-contained",
  ])(
    "aggregates external source devices against qualified Profile names (%s)",
    async (qualified) => {
      const project = createEmptyProject("source-process", "Source process");
      const applied = executeProjectTransaction(project, {
        projectId: project.id,
        expectedStructureRevision: 0,
        transactionId: "process-source",
        actor: { kind: "agent", id: "test" },
        edits: [
          {
            kind: "apply_model_source",
            source: {
              id: "owner",
              revision: 0,
              language: "spice",
              entry: "mos.spice",
              dependencies: [],
              files: [
                {
                  path: "mos.spice",
                  text: ".subckt pair\nX1 d g s b sg13_lv_nmos w=1u l=130n ng=1 m=1\n.ends pair\n",
                },
              ],
            },
            definitions: [{ definitionId: "pair", entry: "pair" }],
          },
        ],
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      const next = applied.project;
      next.documents[0]!.instances.push(
        createExternalSubcircuitInstance(
          "XTOP",
          next.externalSubcircuitDefinitions[0]!,
          { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        ),
      );
      const folder = createSimulationFolder({
        id: "process",
        name: "Process",
        profileId: "ngspice",
        engine: "ngspice",
        documentId: next.topDocumentId,
      });
      next.simulationFolders = [folder];
      const caps = nativeSweepFixture().caps;
      caps.profiles[0]!.devices =
        qualified === undefined
          ? undefined
          : qualified === true
            ? ["sg13_lv_nmos"]
            : ["sky130_fd_pr__nfet_01v8"];
      if (qualified === undefined) {
        // Registered bytes alone do not establish the masters they implement.
        next.modelSources![0]!.dependencies = [
          { id: "models", sha256: "a".repeat(64), mountPath: "unrelated.lib" },
        ];
        next.modelSources![0]!.files[0]!.text =
          '.include "unrelated.lib"\n' + next.modelSources![0]!.files[0]!.text;
      }
      if (qualified === "local-primitive-shadow") {
        caps.profiles[0]!.devices = [];
        caps.profiles[0]!.dependencies = [];
        next.modelSources![0]!.files[0]!.text =
          ".subckt hidden\n.model sg13_lv_nmos nmos(level=1)\n.ends hidden\n" +
          next.modelSources![0]!.files[0]!.text;
      }
      if (qualified === "local-self-contained") {
        caps.profiles[0]!.devices = [];
        caps.profiles[0]!.dependencies = [];
        caps.modelLibrary = undefined;
        next.modelSources![0]!.files[0]!.text =
          ".subckt pair\n.model local nmos(level=1)\nM1 d g s b local w=1u l=130n\n.ends pair\n";
      }
      const before = structuredClone(next);
      const prepared = await prepareNgspiceExecutionInput(next, folder, caps);
      expect(prepared.ok, JSON.stringify(prepared)).toBe(
        qualified === true || qualified === "local-self-contained",
      );
      if (prepared.ok && qualified === "local-self-contained")
        expect(prepared.input.dependencies).toEqual([]);
      else if (prepared.ok)
        expect(
          prepared.input.files.some((f) =>
            f.text.includes('.lib "icm-models.lib" tt'),
          ),
        ).toBe(true);
      else
        expect(prepared.error.diagnostics?.[0]).toMatchObject({
          code: "MODEL_SOURCE_PROFILE_CONFLICT",
          modelSource: { sourceId: "owner", revision: 1 },
        });
      expect(next).toEqual(before);
    },
  );
  it.each([
    ["sky130_fd_pr__nfet_g5v0d10v5", true],
    ["sky130_fd_pr__pfet_g5v0d10v5", true],
    ["sky130_fd_pr__nfet_03v3_nvt", false],
    ["sky130_fd_pr__npn_05v5_W1p00L1p00", true],
    ["sky130_fd_pr__npn_11v0_W1p00L1p00", false],
    ["sky130_fd_pr__res_xhigh_po", true],
  ])(
    "checks a Gallery model source's %s against the hosted SKY130 Profile",
    async (master, qualified) => {
      const project = createEmptyProject("gallery-5v", "Gallery 5 V");
      const applied = executeProjectTransaction(project, {
        projectId: project.id,
        expectedStructureRevision: 0,
        transactionId: "gallery-5v-source",
        actor: { kind: "agent", id: "test" },
        edits: [
          {
            kind: "apply_model_source",
            source: {
              id: "owner",
              revision: 0,
              language: "spice",
              entry: "mos.spice",
              dependencies: [],
              files: [
                {
                  path: "mos.spice",
                  text: `.subckt pair\n${
                    master.includes("__npn_")
                      ? `X1 c b e s ${master}`
                      : master.includes("__res_")
                        ? `X1 a b 0 ${master} w=1 l=10 mult=1`
                        : `X1 d g s b ${master} w=3 l=0.5`
                  }\n.ends pair\n`,
                },
              ],
            },
            definitions: [{ definitionId: "pair", entry: "pair" }],
          },
        ],
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      const next = applied.project;
      next.documents[0]!.instances.push(
        createExternalSubcircuitInstance(
          "XTOP",
          next.externalSubcircuitDefinitions[0]!,
          { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        ),
      );
      const folder = createSimulationFolder({
        id: "process",
        name: "Process",
        profileId: "ngspice",
        engine: "ngspice",
        documentId: next.topDocumentId,
      });
      next.simulationFolders = [folder];
      const caps = nativeSweepFixture().caps;
      caps.profiles[0]!.devices = hostedSky130.qualifiedScope.devices;
      const prepared = await prepareNgspiceExecutionInput(next, folder, caps);
      expect(prepared.ok, JSON.stringify(prepared)).toBe(qualified);
      if (!prepared.ok)
        expect(prepared.error.diagnostics?.[0]).toMatchObject({
          code: "MODEL_SOURCE_PROFILE_CONFLICT",
        });
    },
  );
  // boboIC Gallery entries wrap the 3.4 um vertical PNP and the 5 V NPN in a
  // parameterized subcircuit; the 11 V NPN stays outside the Profile.
  it.each([
    ["sky130_fd_pr__pnp_05v5_W3p40L3p40", "C B E", true],
    ["sky130_fd_pr__npn_05v5_W1p00L1p00", "C B E 0", true],
    ["sky130_fd_pr__npn_11v0_W1p00L1p00", "C B E 0", false],
  ])(
    "checks a Gallery model source's %s against the hosted SKY130 Profile",
    async (master, nodes, qualified) => {
      const project = createEmptyProject("gallery-pnp", "Gallery PNP");
      const applied = executeProjectTransaction(project, {
        projectId: project.id,
        expectedStructureRevision: 0,
        transactionId: "gallery-pnp-source",
        actor: { kind: "agent", id: "test" },
        edits: [
          {
            kind: "apply_model_source",
            source: {
              id: "owner",
              revision: 0,
              language: "spice",
              entry: "bjt.spice",
              dependencies: [],
              files: [
                {
                  path: "bjt.spice",
                  text: [
                    ".subckt IV_SKY_PNP C B E params: AREA=1",
                    `XPDK ${nodes} ${master} m={AREA}`,
                    ".ends IV_SKY_PNP",
                    ".subckt mirror",
                    "XQ c b e IV_SKY_PNP AREA=4",
                    ".ends mirror",
                    "",
                  ].join("\n"),
                },
              ],
            },
            definitions: [{ definitionId: "mirror", entry: "mirror" }],
          },
        ],
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      const next = applied.project;
      next.documents[0]!.instances.push(
        createExternalSubcircuitInstance(
          "XTOP",
          next.externalSubcircuitDefinitions[0]!,
          { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        ),
      );
      const folder = createSimulationFolder({
        id: "process",
        name: "Process",
        profileId: "ngspice",
        engine: "ngspice",
        documentId: next.topDocumentId,
      });
      next.simulationFolders = [folder];
      const caps = nativeSweepFixture().caps;
      caps.profiles[0]!.devices = hostedSky130.qualifiedScope.devices;
      const prepared = await prepareNgspiceExecutionInput(next, folder, caps);
      expect(prepared.ok, JSON.stringify(prepared)).toBe(qualified);
      if (!prepared.ok)
        expect(prepared.error.diagnostics?.[0]).toMatchObject({
          code: "MODEL_SOURCE_PROFILE_CONFLICT",
        });
    },
  );
  it.each(["sky130_fd_pr__diode_pw2nd_05v5", "sky130_fd_pr__diode_pd2nw_05v5"])(
    "runs a drawn %s and a model source calling it on the hosted SKY130 Profile",
    async (master) => {
      const project = createEmptyProject("gallery-diode", "Gallery diode");
      const applied = executeProjectTransaction(project, {
        projectId: project.id,
        expectedStructureRevision: 0,
        transactionId: "gallery-diode-source",
        actor: { kind: "agent", id: "test" },
        edits: [
          {
            kind: "apply_model_source",
            source: {
              id: "owner",
              revision: 0,
              language: "spice",
              entry: "esd.spice",
              dependencies: [],
              files: [
                {
                  path: "esd.spice",
                  text: `.subckt esd pad\nXD1 0 pad ${master} area=100 perim=40\n.ends esd\n`,
                },
              ],
            },
            definitions: [{ definitionId: "esd", entry: "esd" }],
          },
        ],
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      let next = applied.project;
      const top = next.documents[0]!;
      top.instances.push(
        createExternalSubcircuitInstance(
          "XTOP",
          next.externalSubcircuitDefinitions[0]!,
          { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        ),
        {
          id: "D2",
          symbolId: "diode",
          reference: "D2",
          placement: {
            position: { x: 100, y: 0 },
            rotation: 0,
            mirror: "none",
          },
          netlist: {
            binding: { kind: "model", deviceClass: "diode", name: "DIODE" },
            parameters: {},
          },
        },
      );
      top.nets.push(
        {
          id: "pad",
          terminals: [
            { instanceId: "D2", pinName: "K" },
            { instanceId: "XTOP", pinName: "pad" },
          ],
        },
        { id: "gnd", terminals: [{ instanceId: "D2", pinName: "A" }] },
      );
      // Choosing the diode in Properties binds the drawn part to its wrapper.
      const bound = executeProjectTransaction(next, {
        projectId: next.id,
        expectedStructureRevision: next.structureRevision,
        transactionId: "gallery-diode-model",
        actor: { kind: "agent", id: "test" },
        edits: planSetDeviceModelTarget(next, top.id, "D2", master),
      });
      expect(bound.ok, JSON.stringify(bound)).toBe(true);
      if (!bound.ok) return;
      next = bound.project;
      const folder = createSimulationFolder({
        id: "process",
        name: "Process",
        profileId: "ngspice",
        engine: "ngspice",
        documentId: next.topDocumentId,
      });
      next.simulationFolders = [folder];
      const caps = nativeSweepFixture().caps;
      caps.profiles[0]!.devices = hostedSky130.qualifiedScope.devices;
      const prepared = await prepareNgspiceExecutionInput(next, folder, caps);
      expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
      if (!prepared.ok) return;
      const deck = prepared.input.files
        .map((file) => ("text" in file ? file.text : ""))
        .join("\n");
      expect(deck).toMatch(
        new RegExp(`^XD2 \\S+ \\S+ ${master} area=1 perim=1 m=1$`, "mu"),
      );
      expect(deck).not.toMatch(new RegExp(`^D\\S* .*${master}`, "mu"));
    },
  );
  // #2556: directly drawn reviewed devices enforce the Profile's qualified
  // device list symmetrically with model-source calls.
  it.each([
    ["nmos", "sky130_fd_pr__nfet_g5v0d10v5", true],
    ["nmos", "sky130_fd_pr__nfet_03v3_nvt", false],
    ["npn", "sky130_fd_pr__npn_05v5_W1p00L1p00", true],
    ["npn", "sky130_fd_pr__npn_11v0_W1p00L1p00", false],
    ["inductor", "sky130_fd_pr__ind_05_125", false],
  ] as const)(
    "enforces the hosted SKY130 Profile's qualified devices on directly drawn %s (%s)",
    async (symbolId, master, qualified) => {
      let project = createEmptyProject("drawn-qual", "Drawn qualification");
      const top = project.documents[0]!;
      const pins =
        symbolId === "nmos"
          ? ["D", "G", "S", "B"]
          : symbolId === "npn"
            ? ["C", "B", "E"]
            : ["1", "2"];
      top.instances.push(
        {
          id: "GND1",
          symbolId: "ground",
          placement: {
            position: { x: -40, y: 0 },
            rotation: 0,
            mirror: "none",
          },
        },
        {
          id: "U1",
          symbolId,
          reference:
            symbolId === "nmos" ? "M1" : symbolId === "npn" ? "Q1" : "L1",
          placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
          netlist: {
            binding:
              symbolId === "nmos"
                ? { kind: "model", deviceClass: "mos", name: "NMOS" }
                : symbolId === "npn"
                  ? { kind: "model", deviceClass: "bjt", name: "NPN" }
                  : { kind: "primitive", deviceClass: "inductor" },
            parameters: {},
          },
        },
      );
      top.nets.push({
        id: "gnd",
        terminals: [
          { instanceId: "GND1", pinName: "0" },
          { instanceId: "U1", pinName: pins[0]! },
        ],
      });
      for (const [index, pinName] of pins.slice(1).entries()) {
        top.nets.push({
          id: `n${index + 1}`,
          terminals: [{ instanceId: "U1", pinName }],
        });
      }
      const bound = executeProjectTransaction(project, {
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        transactionId: "drawn-qual-bind",
        actor: { kind: "agent", id: "test" },
        edits: planSetDeviceModelTarget(project, top.id, "U1", master),
      });
      expect(bound.ok, JSON.stringify(bound)).toBe(true);
      if (!bound.ok) return;
      project = bound.project;
      const hiddenGroundPins =
        master === "sky130_fd_pr__npn_05v5_W1p00L1p00"
          ? ["S"]
          : symbolId === "inductor"
            ? ["CT", "SUB"]
            : [];
      if (hiddenGroundPins.length) {
        project = {
          ...project,
          documents: project.documents.map((doc) =>
            doc.id !== top.id
              ? doc
              : {
                  ...doc,
                  nets: doc.nets.map((net) =>
                    net.id !== "gnd"
                      ? net
                      : {
                          ...net,
                          terminals: [
                            ...net.terminals,
                            ...hiddenGroundPins.map((pinName) => ({
                              instanceId: "U1",
                              pinName,
                            })),
                          ],
                        },
                  ),
                },
          ),
        };
      }
      const folder = createSimulationFolder({
        id: "process",
        name: "Process",
        profileId: "ngspice",
        engine: "ngspice",
        documentId: project.topDocumentId,
      });
      project.simulationFolders = [folder];
      const caps = nativeSweepFixture().caps;
      caps.profiles[0]!.devices = hostedSky130.qualifiedScope.devices;
      const prepared = await prepareNgspiceExecutionInput(
        project,
        folder,
        caps,
      );
      expect(prepared.ok, JSON.stringify(prepared)).toBe(qualified);
      if (!prepared.ok) {
        expect(prepared.error.diagnostics?.[0]).toMatchObject({
          code: "MODEL_SOURCE_PROFILE_CONFLICT",
          message: `The selected Profile does not qualify ${master}; change the device or select a qualified Profile.`,
        });
        expect(prepared.error.diagnostics?.[0]).not.toHaveProperty(
          "modelSource",
        );
      }
    },
  );
  it.each([false, true])(
    "protects global device models while respecting a testbench's local scope (%s)",
    async (local) => {
      const project = createEmptyProject("diode", "Diode");
      const definition = {
        id: "amp",
        name: "amp",
        interfaceStatus: "declared" as const,
        formalParameters: [],
        terminals: [{ id: "a", name: "A", direction: "passive" as const }],
        implementation: {
          kind: "source" as const,
          sourceId: "diode",
          entry: "amp",
        },
      };
      project.externalSubcircuitDefinitions.push(definition);
      project.modelSources = [
        {
          id: "diode",
          language: "spice",
          entry: "diode.spice",
          revision: 1,
          dependencies: [],
          files: [
            {
              path: "diode.spice",
              text: ".model shared D(Is=1e-14)\n.subckt amp A\nD1 A 0 shared\n.ends amp\n",
            },
          ],
        },
      ];
      project.documents[0]!.instances.push(
        createExternalSubcircuitInstance("X1", definition, {
          position: { x: 0, y: 0 },
          rotation: 0,
          mirror: "none",
        }),
      );
      project.documents[0]!.noConnects.push({
        id: "nc",
        endpoint: { kind: "terminal", instanceId: "X1", pinName: "A" },
      });
      const folder = createSimulationFolder({
        id: "diode",
        name: "Diode",
        engine: "ngspice",
        profileId: "ngspice",
        documentId: project.topDocumentId,
      });
      const entry = folder.input.files.find(
        (f) => f.path === folder.input.entry,
      )!;
      const card = ".model SHARED D(Is=1e-9)\n";
      entry.text = entry.text.replace(
        ".control",
        (local
          ? `.subckt tb_helper A\n${card}D1 A 0 SHARED\n.ends tb_helper\n`
          : card) + ".control",
      );
      const { caps } = nativeSweepFixture();
      const prepared = await prepareNgspiceExecutionInput(
        project,
        folder,
        caps,
      );
      expect(prepared.ok, JSON.stringify(prepared)).toBe(local);
      if (!prepared.ok)
        expect(prepared.error.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "MODEL_SOURCE_SHADOW",
              path: folder.input.entry,
              sourceRef: expect.any(Object),
            }),
          ]),
        );
    },
  );
  it("refuses a missing legacy implementation despite an unused available dependency", async () => {
    const project = createEmptyProject("legacy", "Legacy");
    const definition = {
      id: "missing",
      name: "missing",
      interfaceStatus: "declared" as const,
      formalParameters: [],
      terminals: [{ id: "a", name: "A", direction: "passive" as const }],
    };
    project.externalSubcircuitDefinitions.push(definition);
    project.documents[0]!.instances.push(
      createExternalSubcircuitInstance("X1", definition, {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      }),
    );
    project.documents[0]!.noConnects.push({
      id: "nc",
      endpoint: { kind: "terminal", instanceId: "X1", pinName: "A" },
    });
    const folder = createSimulationFolder({
      id: "legacy",
      name: "Legacy",
      engine: "ngspice",
      profileId: "ngspice",
      documentId: project.topDocumentId,
    });
    const { caps } = nativeSweepFixture();
    folder.input.dependencies = [
      { id: "models", mountPath: "models.lib", sha256: "a".repeat(64) },
    ];
    const prepared = await prepareNgspiceExecutionInput(project, folder, caps);
    expect(prepared.ok).toBe(false);
    if (!prepared.ok)
      expect(prepared.error.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "MODEL_IMPLEMENTATION_MISSING" }),
        ]),
      );
  });
  it("exports and prepares distinct selected sections in one owned library without a false cycle", async () => {
    const initial = createEmptyProject("sections", "Sections");
    const applied = executeProjectTransaction(initial, {
      projectId: initial.id,
      expectedStructureRevision: 0,
      transactionId: "sections",
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "sections",
            language: "spice",
            entry: "main.spice",
            revision: 0,
            dependencies: [],
            files: [
              { path: "main.spice", text: '.lib "models.lib" COMMON\n' },
              {
                path: "models.lib",
                text: '.lib common\n.lib "models.lib" HeLpEr\n.subckt amp A\nX1 A leaf\n.ends amp\n.endl common\n.lib helper\n.subckt leaf A\nR1 A 0 1k\n.ends leaf\n.endl helper\n',
              },
            ],
          },
          definitions: [{ definitionId: "amp", entry: "amp" }],
        },
      ],
    });
    if (!applied.ok) throw Error(JSON.stringify(applied));
    const project = applied.project;
    project.documents[0]!.instances.push(
      createExternalSubcircuitInstance(
        "X1",
        project.externalSubcircuitDefinitions[0]!,
        { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      ),
    );
    project.documents[0]!.noConnects.push({
      id: "nc",
      endpoint: { kind: "terminal", instanceId: "X1", pinName: "A" },
    });
    const exported = createDesignNetlistExport(project, { format: "spice" });
    expect(exported.status).toBe("ready");
    if (exported.status !== "ready") return;
    expect(exported.file.text.match(/\.subckt leaf A/gu)).toHaveLength(1);
    const folder = createSimulationFolder({
      id: "sections",
      name: "Sections",
      engine: "ngspice",
      profileId: "ngspice",
      documentId: project.topDocumentId,
    });
    const { caps } = nativeSweepFixture();
    const prepared = await prepareNgspiceExecutionInput(project, folder, caps);
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    if (prepared.ok)
      expect(
        prepared.input.files
          .map((f) => f.text)
          .join("\n")
          .match(/\.subckt leaf A/gu),
      ).toHaveLength(1);
  });
  it("resolves a model-owned dependency and corner without copying or editing its source", async () => {
    const initial = createEmptyProject("owned-dependency", "Owned dependency");
    const applied = executeProjectTransaction(initial, {
      projectId: initial.id,
      expectedStructureRevision: 0,
      transactionId: "define",
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "native",
            language: "spice",
            entry: "owned/main.spice",
            files: [
              {
                path: "owned/main.spice",
                text: '.lib "../vendor/models.lib" ss\n.subckt native A\nR1 A 0 1k\n.ends native\n',
              },
            ],
            dependencies: [
              {
                id: "models",
                mountPath: "vendor/models.lib",
                sha256: "a".repeat(64),
              },
            ],
            revision: 0,
          },
          definitions: [{ definitionId: "native", entry: "native" }],
        },
      ],
    });
    if (!applied.ok) throw Error(JSON.stringify(applied));
    const project = applied.project;
    project.documents[0]!.instances.push(
      createExternalSubcircuitInstance(
        "X1",
        project.externalSubcircuitDefinitions[0]!,
        { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      ),
    );
    project.documents[0]!.noConnects.push({
      id: "nc",
      endpoint: { kind: "terminal", instanceId: "X1", pinName: "A" },
    });
    const folder = createSimulationFolder({
      id: "sim",
      name: "Sim",
      engine: "ngspice",
      profileId: "ngspice",
      documentId: project.documents[0]!.id,
    });
    const { caps } = nativeSweepFixture();
    const before = structuredClone(project);
    const nominal = await prepareNgspiceExecutionInput(project, folder, caps);
    const corner = await prepareNgspiceExecutionInput(project, folder, caps, {
      environment: { corner: "ff" },
    });
    expect(nominal.ok && corner.ok, JSON.stringify({ nominal, corner })).toBe(
      true,
    );
    if (!nominal.ok || !corner.ok) return;
    expect(nominal.input.dependencies).toEqual(
      project.modelSources![0]!.dependencies,
    );
    expect(nominal.input.files.map((f) => f.text).join("\n")).toContain(
      '.lib "vendor/models.lib" ss',
    );
    expect(corner.input.files.map((f) => f.text).join("\n")).toContain(
      '.lib "vendor/models.lib" ff',
    );
    expect(corner.input.inputRevision).not.toBe(nominal.input.inputRevision);
    expect(project).toEqual(before);
  });
  it("projects native corner, temperature and exact Canvas parameters into one immutable run", async () => {
    const { project, folder, entry, caps } = nativeSweepFixture();
    const document = project.documents.find((item) =>
      item.instances.some((instance) => instance.netlist?.parameters.w),
    )!;
    const instance = document.instances.find(
      (item) => item.netlist?.parameters.w,
    )!;
    const before = structuredClone(project);
    const nominal = await prepareNgspiceExecutionInput(project, folder, caps);
    const variant = {
      environment: { corner: "ff", temperatureC: 125 },
      parameters: [
        {
          documentId: document.id,
          instanceId: instance.id,
          parameter: "w",
          value: "33u",
        },
      ],
    };
    const point = await prepareNgspiceExecutionInput(
      project,
      folder,
      caps,
      variant,
    );
    if (!nominal.ok || !point.ok)
      throw Error(JSON.stringify({ nominal, point }));
    expect(nominal.input.environment.corner).toBe("ss");
    expect(point.input.environment).toMatchObject({
      corner: "ff",
      temperatureC: 125,
    });
    const text = point.input.files.find(
      (file) => file.path === entry.path,
    )!.text;
    expect(text).toContain('.lib "models.lib" ff');
    expect(text).toContain(".temp 125");
    expect(text).not.toContain('.lib "models.lib" ss');
    expect(point.generated.map((file) => file.text).join("\n")).toContain(
      "w=33",
    );
    expect(point.input.inputRevision).not.toBe(nominal.input.inputRevision);
    expect(point.digest).not.toBe(nominal.digest);
    expect(
      await new ProjectInputIdentity().read(
        project,
        folder.id,
        variant,
        "ngspice",
      ),
    ).toBe(point.input.inputRevision);
    const map = point.sourceMaps.find((item) => item.path === entry.path)!;
    expect(locateSimulationText(map, text.indexOf("ff"))).toMatchObject({
      kind: "generated",
      purpose: "run-variant",
      nominal: { path: entry.path },
    });
    expect(project).toEqual(before);
  });

  const inputDigests = (prepared: {
    input: { netlist: string; testbench: string; preparedDeck: string };
  }) =>
    createSimulationInputMetadata({
      netlist: prepared.input.netlist,
      testbench: prepared.input.testbench,
      deck: prepared.input.preparedDeck,
    });

  it("names the drawn circuit in the netlist digest, apart from the testbench (#1243)", async () => {
    const { project, folder, caps } = nativeSweepFixture();
    const nominal = await prepareNgspiceExecutionInput(project, folder, caps);
    if (!nominal.ok) throw Error(JSON.stringify(nominal));
    const [generated] = nominal.generated;
    const circuit = nominal.input.files.find(
      (file) => file.path === generated!.path,
    )!;
    // The circuit file as sent, which the run's catalog lists by digest.
    expect(nominal.input.netlist).toBe(circuit.text);
    const before = await inputDigests(nominal);
    // Only the drawing changes: one device width.
    const instance = project.documents
      .flatMap((document) => document.instances)
      .find((item) => item.netlist?.parameters.w)!;
    instance.netlist!.parameters.w = "33u";
    const edited = await prepareNgspiceExecutionInput(project, folder, caps);
    if (!edited.ok) throw Error(JSON.stringify(edited));
    const after = await inputDigests(edited);
    expect(after.netlistSha256).not.toBe(before.netlistSha256);
    expect(after.testbenchSha256).toBe(before.testbenchSha256);
    // A second copy that would take the serialized input past the budget
    // stays unsent: the files alone still run.
    const withoutCopy = new TextEncoder().encode(
      JSON.stringify({
        ...edited.input,
        netlist: "",
        testbench: edited.input.preparedDeck,
      }),
    ).length;
    const tight = await prepareNgspiceExecutionInput(project, folder, {
      ...caps,
      maxInputBytes: withoutCopy,
    });
    if (!tight.ok) throw Error(JSON.stringify(tight));
    expect(tight.input.netlist).toBe("");
    expect(tight.input.testbench).toBe(tight.input.preparedDeck);
  });

  it("names all authored testbench files in testbenchSha256 apart from entry deckSha256 (#1407)", async () => {
    const { project, folder, entry, caps } = nativeSweepFixture();
    folder.input.files.push({
      path: "testbench.spice",
      text: "* included stimuli\nVaux aux 0 dc 0.5\n",
    });
    entry.text = entry.text.replace(
      '.include "circuit.spice"',
      '.include "testbench.spice"\n.include "circuit.spice"',
    );

    const first = await prepareNgspiceExecutionInput(project, folder, caps);
    if (!first.ok) throw Error(JSON.stringify(first));
    expect(first.input.testbench).not.toBe(first.input.preparedDeck);
    expect(first.input.testbench).toContain("Vaux aux 0 dc 0.5");
    expect(first.input.testbench).toContain(first.input.preparedDeck);
    expect(
      isRawMultiFileTestbench(
        first.input.testbench,
        first.input.preparedDeck,
        first.input.files,
        first.input.entryPath,
      ),
    ).toBe(true);
    const before = await inputDigests(first);
    expect(before.testbenchSha256).not.toBe(before.deckSha256);

    // Editing only the included testbench moves testbenchSha256 while keeping
    // both netlistSha256 and entry deckSha256 unchanged.
    const included = folder.input.files.find(
      (file) => file.path === "testbench.spice",
    )!;
    included.text = "* included stimuli\nVaux aux 0 dc 0.75\n";
    const second = await prepareNgspiceExecutionInput(project, folder, caps);
    if (!second.ok) throw Error(JSON.stringify(second));
    const after = await inputDigests(second);
    expect(after.testbenchSha256).not.toBe(before.testbenchSha256);
    expect(after.netlistSha256).toBe(before.netlistSha256);
    expect(after.deckSha256).toBe(before.deckSha256);

    // When the authored-testbench copy alone would exceed the budget, it falls
    // back to the executed entry deck while netlist keeps fitting.
    const withoutExtraTestbench = new TextEncoder().encode(
      JSON.stringify({
        ...second.input,
        testbench: second.input.preparedDeck,
      }),
    ).length;
    const tight = await prepareNgspiceExecutionInput(project, folder, {
      ...caps,
      maxInputBytes: withoutExtraTestbench,
    });
    if (!tight.ok) throw Error(JSON.stringify(tight));
    expect(tight.input.netlist).toBe(second.input.netlist);
    expect(tight.input.testbench).toBe(tight.input.preparedDeck);

    // An empty entry file must not pair with a non-empty multi-file testbench.
    folder.input.circuitBindings = [];
    folder.input.dependencies = [];
    entry.text = "";
    const emptyEntry = await prepareNgspiceExecutionInput(
      project,
      folder,
      caps,
    );
    if (emptyEntry.ok) {
      expect(emptyEntry.input.preparedDeck).toBe("");
      expect(emptyEntry.input.testbench).toBe("");
    }
  });

  it("selects the requested section when Profile models are inserted automatically", async () => {
    const { project, folder, entry, caps } = nativeSweepFixture();
    entry.text = entry.text.replace('.lib "models.lib" ss\n', "");
    folder.input.dependencies = [];
    const point = await prepareNgspiceExecutionInput(project, folder, caps, {
      environment: { corner: "ff" },
    });
    if (!point.ok) throw Error(JSON.stringify(point));
    const text = point.input.files.find(
      (file) => file.path === entry.path,
    )!.text;
    expect(text).toMatch(/\.lib\s+"icm-models\.lib"\s+ff/u);
    expect(text.match(/\.lib\s+/gu)).toHaveLength(1);
    expect(point.input.environment.corner).toBe("ff");
  });

  it("rejects conflicting native Profile loads instead of silently selecting a requested corner", async () => {
    const { project, folder, entry, caps } = nativeSweepFixture();
    entry.text = entry.text.replace(
      '.lib "models.lib" ss',
      '.lib "models.lib" ss\n.lib "models.lib" tt',
    );
    const result = await prepareNgspiceExecutionInput(project, folder, caps, {
      environment: { corner: "ff" },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_COMPILE_REFUSED",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "SIMULATION_MODEL_CORNER_CONFLICT" }),
        ]),
      },
    });
  });

  it("rejects a plain Profile include and a corner without a model target", async () => {
    const { project, folder, entry, caps } = nativeSweepFixture();
    entry.text = entry.text.replace(
      '.lib "models.lib" ss',
      '.include "models.lib"',
    );
    const plainInclude = await prepareNgspiceExecutionInput(
      project,
      folder,
      caps,
      { environment: { corner: "ff" } },
    );
    expect(plainInclude).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_COMPILE_REFUSED",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "SIMULATION_MODEL_CORNER_CONFLICT" }),
        ]),
      },
    });

    const graphless = createSimulationFolder({
      id: "graphless",
      name: "Graphless",
      profileId: "ngspice",
      engine: "ngspice",
    });
    const missing = await prepareNgspiceExecutionInput(
      project,
      graphless,
      caps,
      { environment: { corner: "ff" } },
    );
    expect(missing).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_CORNER_TARGET_MISSING" },
    });
  });
  it.each([undefined, "ff"])(
    "keeps Profile-resolved corner %s out of source identity",
    async (corner) => {
      const project = CircuitProjectSchema.parse(
        currentFiveTransistorOtaCircuitSource(),
      );
      const folder = createSimulationFolder({
        id: "native",
        name: "Native",
        profileId: "ngspice",
        engine: "ngspice",
        documentId: project.topDocumentId,
      });
      folder.input.files.find((f) => f.path === folder.input.configPath)!.text =
        JSON.stringify({
          version: 2,
          environment: { profileId: "ngspice" },
        });
      if (corner) {
        folder.input.dependencies = [
          { id: "models", sha256: "a".repeat(64), mountPath: "models.lib" },
        ];
        const entry = folder.input.files.find(
          (f) => f.path === folder.input.entry,
        )!;
        entry.text = entry.text.replace(
          "\n",
          `\n.lib "models.lib" ${corner}\n`,
        );
      }
      project.simulationFolders = [folder];
      const before = structuredClone(project);
      const caps = CapabilitiesSchema.parse({
        configured: true,
        rawfileCollection: "declared-single-ascii",
        inputs: ["source"],
        analyses: ["op"],
        parsedAnalyses: ["op"],
        profiles: [
          {
            id: "ngspice",
            corners: ["tt", "ff"],
            dependencies: [{ id: "models", sha256: "a".repeat(64) }],
          },
        ],
        modelLibrary: { path: "models.lib", section: "tt" },
        maxInputBytes: 2 * 1024 * 1024,
        maxOutputBytes: 1024 * 1024,
        maxTimeoutMs: 15000,
        cancel: true,
      });
      const prepared = await prepareNgspiceExecutionInput(
        project,
        folder,
        caps,
      );
      if (!prepared.ok) throw Error(JSON.stringify(prepared));
      expect(prepared.input.environment.corner).toBe(corner ?? "tt");
      const identity = new ProjectInputIdentity();
      expect(
        await identity.read(project, folder.id, undefined, "ngspice"),
      ).toBe(prepared.input.inputRevision);
      expect(project).toEqual(before);
      project.documents[0]!.revision++;
      expect(
        await identity.read(project, folder.id, undefined, "ngspice"),
      ).toBe(prepared.input.inputRevision);
      folder.input.files.find((f) => f.path === folder.input.entry)!.text +=
        "\n* source changed\n";
      project.structureRevision++;
      expect(
        await identity.read(project, folder.id, undefined, "ngspice"),
      ).not.toBe(prepared.input.inputRevision);
    },
  );
});

/**
 * The gates, under a Profile that declares an HD cell library beside its
 * models. Its id names neither the library nor a file kind: what it supplies
 * and how it loads are the Profile's declarations.
 */
function standardCellFixture() {
  const { project, folder } = standardCellGates("ngspice");
  const caps = nativeSweepFixture().caps;
  caps.profiles[0]!.cellLibraries = [
    {
      id: "hd-cells",
      sha256: "c".repeat(64),
      cells: "sky130_fd_sc_hd",
      directive: "include",
    },
  ];
  return { project, folder, caps };
}

describe("a Library gate bound to a PDK standard cell (#1596)", () => {
  it("mounts the Profile's cell library beside its models and calls the cell in its pin order", async () => {
    const { project, folder, caps } = standardCellFixture();
    const prepared = await prepareNgspiceExecutionInput(project, folder, caps, {
      environment: { corner: "ff" },
    });
    if (!prepared.ok) throw Error(JSON.stringify(prepared));
    expect(prepared.input.dependencies).toEqual([
      { id: "models", sha256: "a".repeat(64), mountPath: "icm-models.lib" },
      {
        id: "hd-cells",
        sha256: "c".repeat(64),
        mountPath: "sky130_fd_sc_hd.spice",
      },
    ]);
    const entry = prepared.input.files.find(
      (file) => file.path === folder.input.entry,
    )!.text;
    // The corner selects the primitives; the cells take no section.
    expect(entry).toMatch(
      /\.lib "icm-models\.lib" ff\n(?:\*[^\n]*\n)?\.include "sky130_fd_sc_hd\.spice"\n/u,
    );
    const circuit = prepared.input.files.find(
      (file) => file.path === "circuit.spice",
    )!.text;
    // A, B, then VGND VNB on ground and VPB VPWR on VDD, then Y.
    expect(circuit).toContain(
      "X1 net0 net1 0 0 VDD VDD net2 sky130_fd_sc_hd__nor2_1\n",
    );
    expect(circuit).toContain(
      "X2 net0 0 0 VDD VDD net3 sky130_fd_sc_hd__inv_1\n",
    );
    expect(circuit).toContain(
      "X3 net0 net1 0 0 VDD VDD net4 sky130_fd_sc_hd__nand2_1\n",
    );
    expect(circuit).not.toMatch(/\.subckt/u);
  });

  it("keeps an author's own load of the cell library and adds no second one", async () => {
    const { project, folder, caps } = standardCellFixture();
    folder.input.dependencies = [
      { id: "models", sha256: "a".repeat(64), mountPath: "pdk/models.lib" },
      {
        id: "hd-cells",
        sha256: "c".repeat(64),
        mountPath: "pdk/cells.spice",
      },
    ];
    const entry = folder.input.files.find(
      (file) => file.path === folder.input.entry,
    )!;
    entry.text = entry.text.replace(
      '.include "circuit.spice"',
      '.lib "pdk/models.lib" tt\n.include "pdk/cells.spice"\n.include "circuit.spice"',
    );
    const prepared = await prepareNgspiceExecutionInput(project, folder, caps);
    if (!prepared.ok) throw Error(JSON.stringify(prepared));
    expect(prepared.input.dependencies).toEqual(folder.input.dependencies);
    const text = prepared.input.files.find(
      (file) => file.path === entry.path,
    )!.text;
    expect(text.match(/\.include "pdk\/cells\.spice"/gu)).toHaveLength(1);
    expect(text.match(/\.lib /gu)).toHaveLength(1);
  });

  it("refuses a cell whose library the selected Profile does not provide", async () => {
    const { project, folder, caps } = standardCellFixture();
    delete caps.profiles[0]!.cellLibraries;
    const prepared = await prepareNgspiceExecutionInput(project, folder, caps);
    expect(prepared).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_COMPILE_REFUSED",
        diagnostics: ["nor2_1", "inv_1", "nand2_1"].map((cell) =>
          expect.objectContaining({
            code: "STANDARD_CELL_LIBRARY_UNAVAILABLE",
            message: expect.stringContaining(cell),
            path: "circuit.spice",
          }),
        ),
      },
    });
  });

  it("refuses a cell declared out of its library's pin order", async () => {
    const { project, folder, caps } = standardCellFixture();
    const nor = project.externalSubcircuitDefinitions.find(
      (definition) => definition.name === "sky130_fd_sc_hd__nor2_1",
    )!;
    // Y before the rails: the library's subcircuit would be miswired.
    nor.terminals.push(...nor.terminals.splice(2, 4));
    const prepared = await prepareNgspiceExecutionInput(project, folder, caps);
    expect(prepared).toMatchObject({
      ok: false,
      error: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: "STANDARD_CELL_UNSUPPORTED",
            message: expect.stringContaining("not in the library's order"),
          }),
        ]),
      },
    });
  });

  it("says which standard cells run when a definition names an unsupported one", async () => {
    const { project, folder, caps } = standardCellFixture();
    const definition = {
      id: "flop",
      name: "sky130_fd_sc_hd__dfxtp_1",
      interfaceStatus: "declared" as const,
      formalParameters: [],
      terminals: ["CLK", "D", "VGND", "VNB", "VPB", "VPWR", "Q"].map(
        (name) => ({ id: name, name, direction: "passive" as const }),
      ),
    };
    project.externalSubcircuitDefinitions.push(definition);
    project.documents[0]!.instances.push(
      createExternalSubcircuitInstance("X4", definition, {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      }),
    );
    project.documents[0]!.noConnects.push(
      ...definition.terminals.map((terminal) => ({
        id: `nc-${terminal.name}`,
        endpoint: {
          kind: "terminal" as const,
          instanceId: "X4",
          pinName: terminal.name,
        },
      })),
    );
    const prepared = await prepareNgspiceExecutionInput(project, folder, caps);
    expect(prepared).toMatchObject({
      ok: false,
      error: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: "STANDARD_CELL_UNSUPPORTED",
            message: expect.stringContaining("Provide a Project model source"),
          }),
        ]),
      },
    });
  });

  it("no longer takes any loaded dependency as the body of an unreviewed definition", async () => {
    const { project, folder, caps } = standardCellFixture();
    const definition = {
      id: "missing",
      name: "missing_amp",
      interfaceStatus: "declared" as const,
      formalParameters: [],
      terminals: [{ id: "a", name: "A", direction: "passive" as const }],
    };
    project.externalSubcircuitDefinitions.push(definition);
    project.documents[0]!.instances.push(
      createExternalSubcircuitInstance("X4", definition, {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      }),
    );
    project.documents[0]!.noConnects.push({
      id: "nc",
      endpoint: { kind: "terminal", instanceId: "X4", pinName: "A" },
    });
    folder.input.dependencies = [
      {
        id: "hd-cells",
        sha256: "c".repeat(64),
        mountPath: "cells.spice",
      },
    ];
    const entry = folder.input.files.find(
      (file) => file.path === folder.input.entry,
    )!;
    // Loaded, and still not a body for missing_amp: it defines the cells.
    entry.text = entry.text.replace(
      '.include "circuit.spice"',
      '.include "cells.spice"\n.include "circuit.spice"',
    );
    const prepared = await prepareNgspiceExecutionInput(project, folder, caps);
    expect(prepared).toMatchObject({
      ok: false,
      error: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: "MODEL_IMPLEMENTATION_MISSING",
            message: expect.stringContaining("missing_amp"),
          }),
        ]),
      },
    });
    if (!prepared.ok)
      expect(
        prepared.error.diagnostics?.filter(
          (diagnostic) => diagnostic.code === "MODEL_IMPLEMENTATION_MISSING",
        ),
      ).toHaveLength(1);
  });
});

describe("ngspice preparation advisories", () => {
  async function prepareSky130ModelSource(
    id: string,
    sourceText: string,
    extraEntryLines: readonly string[] = [],
  ) {
    const project = createEmptyProject(id, id);
    const applied = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: `${id}-source`,
      actor: { kind: "agent", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "owner",
            revision: 0,
            language: "spice",
            entry: "wrapper.spice",
            dependencies: [],
            files: [{ path: "wrapper.spice", text: sourceText }],
          },
          definitions: [{ definitionId: "stage", entry: "stage" }],
        },
      ],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error("apply_model_source failed");
    const next = applied.project;
    next.documents[0]!.instances.push(
      createExternalSubcircuitInstance(
        "XTOP",
        next.externalSubcircuitDefinitions[0]!,
        { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      ),
    );
    const folder = createSimulationFolder({
      id: "sky",
      name: "SKY130",
      profileId: hostedSky130.id,
      engine: "ngspice",
      documentId: next.topDocumentId,
    });
    if (extraEntryLines.length) {
      const entry = folder.input.files.find(
        (file) => file.path === folder.input.entry,
      )!;
      entry.text = entry.text.replace(
        '.include "circuit.spice"',
        [...extraEntryLines, '.include "circuit.spice"'].join("\n"),
      );
    }
    next.simulationFolders = [folder];
    const caps = nativeSweepFixture().caps;
    caps.profiles = [
      {
        id: hostedSky130.id,
        corners: hostedSky130.qualifiedScope.sections,
        devices: hostedSky130.qualifiedScope.devices,
        dependencies: [{ id: hostedSky130.models.id, sha256: "a".repeat(64) }],
      },
    ];
    return prepareNgspiceExecutionInput(next, folder, caps);
  }

  async function prepareStandaloneDeck(
    id: string,
    deckLines: readonly string[],
  ) {
    const project = createEmptyProject(id, id);
    const folder = createSimulationFolder({
      id,
      name: id,
      profileId: "ngspice",
      engine: "ngspice",
      documentId: project.topDocumentId,
    });
    const entry = folder.input.files.find(
      (file) => file.path === folder.input.entry,
    )!;
    entry.text = deckLines.join("\n") + "\n";
    project.simulationFolders = [folder];
    return prepareNgspiceExecutionInput(
      project,
      folder,
      nativeSweepFixture().caps,
    );
  }

  it("warns when an AC analysis runs on a deck using ngspice SW switches", async () => {
    const { project, folder, entry, caps } = nativeSweepFixture();
    const doc = project.documents[0]!;
    doc.instances.push({
      id: "S1",
      symbolId: "ideal-switch",
      reference: "S1",
      placement: null,
    });
    doc.nets.push(
      { id: "sw-a", terminals: [{ instanceId: "S1", pinName: "1" }] },
      { id: "sw-b", terminals: [{ instanceId: "S1", pinName: "2" }] },
    );
    entry.text = entry.text.replace("\nop\n", "\nac dec 10 1 1Meg\n");
    const prepared = await prepareNgspiceExecutionInput(project, folder, caps);
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.warnings).toContainEqual(
      expect.stringMatching(/SWacLoad|zero.*conductance|SW switch/iu),
    );
  });

  it("warns on ideal_chopper in a .control ac run and ideal_spdt in a .ac directive run", async () => {
    const chopperProject = createEmptyProject("chopper-ac", "Chopper AC");
    const chopperDoc = chopperProject.documents[0]!;
    chopperDoc.instances.push({
      id: "CH1",
      symbolId: "chopper",
      reference: "XCH1",
      placement: null,
    });
    for (const pinName of ["INP", "INN", "OUTP", "OUTN"]) {
      chopperDoc.nets.push({
        id: `net-${pinName}`,
        terminals: [{ instanceId: "CH1", pinName }],
      });
    }
    const chopperFolder = createSimulationFolder({
      id: "chop-ac",
      name: "Chopper AC",
      profileId: "ngspice",
      engine: "ngspice",
      documentId: chopperProject.topDocumentId,
      template: "ac",
    });
    chopperProject.simulationFolders = [chopperFolder];
    const chopperPrepared = await prepareNgspiceExecutionInput(
      chopperProject,
      chopperFolder,
      nativeSweepFixture().caps,
    );
    expect(chopperPrepared.ok, JSON.stringify(chopperPrepared)).toBe(true);
    if (!chopperPrepared.ok) return;
    expect(chopperPrepared.warnings).toContainEqual(
      expect.stringMatching(/SWacLoad|SW switch/iu),
    );

    const spdtProject = createEmptyProject("spdt-ac", "SPDT AC");
    const spdtDoc = spdtProject.documents[0]!;
    spdtDoc.instances.push({
      id: "SP1",
      symbolId: "spdt-switch",
      reference: "XSP1",
      placement: null,
    });
    for (const pinName of ["COM", "A", "B"]) {
      spdtDoc.nets.push({
        id: `net-${pinName}`,
        terminals: [{ instanceId: "SP1", pinName }],
      });
    }
    const spdtFolder = createSimulationFolder({
      id: "spdt-ac",
      name: "SPDT AC",
      profileId: "ngspice",
      engine: "ngspice",
      documentId: spdtProject.topDocumentId,
    });
    const spdtEntry = spdtFolder.input.files.find(
      (file) => file.path === spdtFolder.input.entry,
    )!;
    spdtEntry.text = [
      "SPDT .ac directive",
      '.include "circuit.spice"',
      ".ac dec 10 1 1Meg",
      ".end",
      "",
    ].join("\n");
    spdtProject.simulationFolders = [spdtFolder];
    const spdtPrepared = await prepareNgspiceExecutionInput(
      spdtProject,
      spdtFolder,
      nativeSweepFixture().caps,
    );
    expect(spdtPrepared.ok, JSON.stringify(spdtPrepared)).toBe(true);
    if (!spdtPrepared.ok) return;
    expect(spdtPrepared.warnings).toContainEqual(
      expect.stringMatching(/SWacLoad|SW switch/iu),
    );
  });

  it("stays silent on TRAN/OP runs, PSpice vswitch models, and uncalled SW subcircuits", async () => {
    const { project, folder, entry, caps } = nativeSweepFixture();
    const doc = project.documents[0]!;
    doc.instances.push({
      id: "S1",
      symbolId: "ideal-switch",
      reference: "S1",
      placement: null,
    });
    doc.nets.push(
      { id: "sw-a", terminals: [{ instanceId: "S1", pinName: "1" }] },
      { id: "sw-b", terminals: [{ instanceId: "S1", pinName: "2" }] },
    );
    entry.text = entry.text.replace("\nop\n", "\ntran 1n 100n\n");
    const tranPrepared = await prepareNgspiceExecutionInput(
      project,
      folder,
      caps,
    );
    expect(tranPrepared.ok, JSON.stringify(tranPrepared)).toBe(true);
    if (tranPrepared.ok) {
      expect(
        tranPrepared.warnings.filter((w) => /SWacLoad|SW switch/iu.test(w)),
      ).toEqual([]);
    }

    const vswitchPrepared = await prepareStandaloneDeck("vswitch-ac", [
      "PSpice vswitch AC",
      ".model my_vsw VSWITCH(RON=1 ROFF=1e12 VON=0.6 VOFF=0.4)",
      "V1 in 0 AC 1",
      "Vc ctrl 0 1",
      "S1 in out ctrl 0 my_vsw",
      "R1 out 0 1k",
      ".ac dec 10 1 1Meg",
      ".end",
    ]);
    expect(vswitchPrepared.ok, JSON.stringify(vswitchPrepared)).toBe(true);
    if (vswitchPrepared.ok) {
      expect(
        vswitchPrepared.warnings.filter((w) => /SWacLoad|SW switch/iu.test(w)),
      ).toEqual([]);
    }

    const uncalledPrepared = await prepareStandaloneDeck("uncalled-sw-ac", [
      "Uncalled SW subcircuit",
      ".subckt dead_sw a b ctrl",
      ".model dead_m SW(RON=1 ROFF=1e12 VT=0.5 VH=0)",
      "S1 a b ctrl 0 dead_m",
      ".ends dead_sw",
      "V1 in 0 AC 1",
      "R1 in 0 1k",
      ".ac dec 10 1 1Meg",
      ".end",
    ]);
    expect(uncalledPrepared.ok, JSON.stringify(uncalledPrepared)).toBe(true);
    if (uncalledPrepared.ok) {
      expect(
        uncalledPrepared.warnings.filter((w) => /SWacLoad|SW switch/iu.test(w)),
      ).toEqual([]);
    }
  });

  it("warns when SKY130 scale=1u mixes with metric W/L across single or multi-hop wrappers and quoted values", async () => {
    const singleHop = await prepareSky130ModelSource(
      "scale-conflict",
      [
        ".subckt IV_SKY_N d g s b params: W=1u L=150n",
        "XM1 d g s b sky130_fd_pr__nfet_01v8 w={W} l={L}",
        ".ends IV_SKY_N",
        ".subckt stage",
        "X1 1 2 0 0 IV_SKY_N W=2u L=180n",
        ".ends stage",
        "",
      ].join("\n"),
    );
    expect(singleHop.ok, JSON.stringify(singleHop)).toBe(true);
    if (singleHop.ok) {
      expect(singleHop.warnings).toContainEqual(
        expect.stringMatching(/option scale|scale=1u/iu),
      );
    }

    const multiHop = await prepareSky130ModelSource(
      "scale-multihop",
      [
        ".subckt INNER_N d g s b params: W=1 L=0.15",
        "XM1 d g s b sky130_fd_pr__nfet_01v8 w='W' l='L'",
        ".ends INNER_N",
        ".subckt MID_N d g s b params: W=1 L=0.15",
        "X1 d g s b INNER_N W={W} L={L}",
        ".ends MID_N",
        ".subckt stage",
        "X2 1 2 0 0 MID_N W='2u' L='150n'",
        ".ends stage",
        "",
      ].join("\n"),
    );
    expect(multiHop.ok, JSON.stringify(multiHop)).toBe(true);
    if (multiHop.ok) {
      expect(multiHop.warnings).toContainEqual(
        expect.stringMatching(/option scale|scale=1u/iu),
      );
    }
  });

  it("respects wrapper unit conversion, explicit .option scale =1 override, and spaced .option scale =1.0u", async () => {
    const safePrepared = await prepareSky130ModelSource(
      "scale-convert",
      [
        ".subckt SAFE_N d g s b params: W=1u L=150n",
        "XM1 d g s b sky130_fd_pr__nfet_01v8 w={W*1e6} l={L*1e6}",
        ".ends SAFE_N",
        ".subckt stage",
        "X1 1 2 0 0 SAFE_N W=2u L=180n",
        ".ends stage",
        "",
      ].join("\n"),
    );
    expect(safePrepared.ok, JSON.stringify(safePrepared)).toBe(true);
    if (safePrepared.ok) {
      expect(
        safePrepared.warnings.filter((w) => /option scale|scale=1u/iu.test(w)),
      ).toEqual([]);
    }

    // Explicit `.option scale =1` (with space before `=`) overrides SKY130 scale=1.0u.
    const overridden = await prepareSky130ModelSource(
      "scale-override",
      [
        ".subckt IV_SKY_N d g s b params: W=1u L=150n",
        "XM1 d g s b sky130_fd_pr__nfet_01v8 w={W} l={L}",
        ".ends IV_SKY_N",
        ".subckt stage",
        "X1 1 2 0 0 IV_SKY_N W=2u L=180n",
        ".ends stage",
        "",
      ].join("\n"),
      [".option scale =1"],
    );
    expect(overridden.ok, JSON.stringify(overridden)).toBe(true);
    if (overridden.ok) {
      expect(
        overridden.warnings.filter((w) => /option scale|scale=1u/iu.test(w)),
      ).toEqual([]);
    }

    // Explicit `.option scale =1.0u` (with space before `=`) triggers on metric M cards.
    const metricPrepared = await prepareStandaloneDeck("metric-m", [
      "Metric M under spaced scale=1.0u",
      ".option scale =1.0u",
      ".model n54 nmos level=54",
      "M1 d g 0 0 n54 w=1u l='150n'",
      "Vd d 0 1",
      "Vg g 0 1",
      ".op",
      ".end",
    ]);
    expect(metricPrepared.ok, JSON.stringify(metricPrepared)).toBe(true);
    if (metricPrepared.ok) {
      expect(metricPrepared.warnings).toContainEqual(
        expect.stringMatching(/option scale|scale=1u/iu),
      );
    }
  });
});
