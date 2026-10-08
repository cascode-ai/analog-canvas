import {
  createEmptyProject,
  createSimulationFolder,
  createRoutePath,
  routeEnd,
} from "@icm/model";
import {
  createDesignNetlistExport,
  compileNgspiceSourceSimulation,
  compileSourceSimulation,
  generateCircuitSource,
  planCircuitSourceEdit,
  planMappedProjectModelEdit,
} from "@icm/netlist";
import { describe, expect, it } from "vitest";
import { executeProjectTransaction } from "./project-transaction.js";
import { createExternalSubcircuitInstance } from "./hierarchy-planner.js";
import { planProjectCellImport } from "./project-cell-import.js";
import { reviewedExternalBindingForMaster } from "@icm/devices";
import type {
  CircuitProject,
  ProjectModelSource,
  ExternalSubcircuitDefinition,
} from "@icm/model";
import type { ProjectStructureEdit } from "./project-transaction.js";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

describe("Project-owned external model source", () => {
  it.each([
    [
      ".subckt Amp A B\nR1 A B 1k\n.ends Amp",
      "X1 A B amp",
      "main.spice",
      3,
      "IDENTIFIER_CASE_COLLISION",
    ],
    [
      ".subckt Amp A B params: GAIN=2\nE1 A B A B {gain}\n.ends Amp",
      "X1 A B Amp",
      "helper.spice",
      2,
      "IDENTIFIER_CASE_COLLISION",
    ],
    [
      ".subckt Amp A B params: GAIN=2\nR1 A B {GAIN}\n.ends Amp",
      "X1 A B Amp gain=3",
      "main.spice",
      3,
      "MODEL_SOURCE_DIALECT",
    ],
  ])(
    "refuses case-changing model references atomically with their owned location (%s)",
    (helper, call, path, line, code) => {
      const project = createEmptyProject("case-refusal", "Case refusal");
      const before = structuredClone(project);
      const result = executeProjectTransaction(project, {
        projectId: project.id,
        expectedStructureRevision: 0,
        transactionId: "convert",
        actor: { kind: "agent", id: "test" },
        edits: [
          {
            kind: "apply_model_source",
            source: {
              id: "owner",
              revision: 0,
              language: "spice",
              entry: "main.spice",
              dependencies: [],
              files: [
                {
                  path: "main.spice",
                  text: `.include "helper.spice"\n.subckt top A B\n${call}\n.ends top\n`,
                },
                { path: "helper.spice", text: helper + "\n" },
              ],
            },
            definitions: [{ definitionId: "top", entry: "top" }],
            transform: { language: "spectre" },
          },
        ],
      });
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [
          expect.objectContaining({
            code,
            message: expect.stringContaining("differ only in case"),
            parameters: expect.objectContaining({ file: path, line }),
          }),
        ],
      });
      expect(project).toEqual(before);
    },
  );
  it.each(["spectre", "spice", undefined] as const)(
    "compares effective draft language before reusing a copied model (%s)",
    (language) => {
      const projects = ["source", "destination"].map((id) => {
        const initial = createEmptyProject(id, id);
        const result = executeProjectTransaction(initial, {
          projectId: initial.id,
          expectedStructureRevision: 0,
          transactionId: "define",
          actor: { kind: "human", id: "test" },
          edits: [
            {
              kind: "apply_model_source",
              source: {
                id: "owner",
                language: "spice",
                revision: 0,
                entry: "model.spice",
                dependencies: [],
                files: [
                  { path: "model.spice", text: ".subckt amp\n.ends amp\n" },
                ],
              },
              definitions: [{ definitionId: "amp", entry: "amp" }],
            },
          ],
        });
        if (!result.ok) throw new Error(JSON.stringify(result));
        const project = result.project;
        project.modelSources![0]!.draft = {
          baseRevision: 1,
          entry: "model.spice",
          ...(id === "source" && language ? { language } : {}),
          files: [{ path: "model.spice", text: "unfinished draft" }],
        };
        project.documents[0]!.instances.push(
          createExternalSubcircuitInstance(
            "X1",
            project.externalSubcircuitDefinitions[0]!,
            { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
          ),
        );
        return project;
      });
      const [source, destination] = projects as [
        CircuitProject,
        CircuitProject,
      ];
      const before = structuredClone(projects);
      const plan = planProjectCellImport(
        destination,
        source,
        source.documents[0]!.id,
      );
      if (language === "spectre") {
        expect(plan).toMatchObject({
          ok: false,
          message: expect.stringContaining("incompatible"),
        });
      } else {
        expect(plan.ok, JSON.stringify(plan)).toBe(true);
        if (!plan.ok || plan.status === "already-imported") return;
        const imported = executeProjectTransaction(destination, {
          projectId: destination.id,
          expectedStructureRevision: destination.structureRevision,
          transactionId: "import",
          actor: { kind: "human", id: "test" },
          edits: [...plan.edits],
        });
        expect(imported.ok, JSON.stringify(imported)).toBe(true);
        if (imported.ok)
          expect(imported.project.modelSources).toEqual(
            destination.modelSources,
          );
      }
      expect(projects).toEqual(before);
    },
  );
  it("rejects colliding global SPICE models inside separate native Spectre owners", () => {
    let project = createEmptyProject("mixed-collision", "Mixed collision");
    for (const [index, name] of ["Local", "local"].entries()) {
      const result = executeProjectTransaction(project, {
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        transactionId: "owner-" + index,
        actor: { kind: "agent", id: "test" },
        edits: [
          {
            kind: "apply_model_source",
            source: {
              id: "owner-" + index,
              revision: 0,
              language: "spectre",
              entry: "model.scs",
              dependencies: [],
              files: [
                {
                  path: "model.scs",
                  text: `simulator lang=spice\n.model ${name} D(Is=1e-14)\nsimulator lang=spectre\nsubckt demo${index} ()\nends demo${index}\n`,
                },
              ],
            },
            definitions: [
              { definitionId: "demo-" + index, entry: "demo" + index },
            ],
          },
        ],
      });
      if (!index) {
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) return;
        project = result.project;
      } else
        expect(result).toMatchObject({
          ok: false,
          diagnostics: [
            expect.objectContaining({ code: "MODEL_SOURCE_NAME_CONFLICT" }),
          ],
        });
    }
  });
  it("retains structured Agent refusal locations without changing the Project", () => {
    const project = createEmptyProject("located-refusal", "Located refusal");
    const result = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "refused-language",
      actor: { kind: "agent", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "owner",
            revision: 0,
            language: "spectre",
            entry: "model.scs",
            dependencies: [],
            files: [
              {
                path: "model.scs",
                text: "subckt demo ()\nB1 (a 0) bsource v=sin(time)\nends demo\n",
              },
            ],
          },
          definitions: [{ definitionId: "demo", entry: "demo" }],
          transform: { language: "spice" },
        },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      project,
      diagnostics: [
        expect.objectContaining({
          code: "UNSUPPORTED_SYNTAX",
          parameters: expect.objectContaining({
            file: "model.scs",
            line: 2,
            sourceId: "owner",
            revision: 0,
          }),
        }),
      ],
    });
    expect(project.modelSources).toBeUndefined();
    const open = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "unclosed",
      actor: { kind: "agent", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "owner",
            revision: 0,
            language: "spectre",
            entry: "open.scs",
            files: [{ path: "open.scs", text: "subckt open ()\n" }],
            dependencies: [],
          },
          definitions: [{ definitionId: "open", entry: "open" }],
        },
      ],
    });
    expect(open).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "MODEL_SOURCE_DECLARATION",
          parameters: expect.objectContaining({ file: "open.scs", line: 1 }),
        }),
      ],
    });
  });
  it("preserves native Spectre case distinctions and refuses an incompatible SPICE projection", () => {
    const project = createEmptyProject("native-case", "Native case");
    const result = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "native-case",
      actor: { kind: "agent", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "owner",
            revision: 0,
            language: "spectre",
            entry: "model.scs",
            dependencies: [],
            files: [
              {
                path: "model.scs",
                text: "subckt demo (A a)\nparameters R=1000 r=2000\nR1 (A a) resistor r=R\nends demo\n",
              },
            ],
          },
          definitions: [{ definitionId: "demo", entry: "demo" }],
        },
      ],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(
      result.project.externalSubcircuitDefinitions[0]?.terminals.map(
        (t) => t.name,
      ),
    ).toEqual(["A", "a"]);
    const document = result.project.documents[0]!;
    const definition = result.project.externalSubcircuitDefinitions[0]!;
    document.instances.push(
      createExternalSubcircuitInstance("X1", definition, {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      }),
    );
    document.noConnects.push(
      ...definition.terminals.map((t) => ({
        id: "nc-" + t.id,
        endpoint: {
          kind: "terminal" as const,
          instanceId: "X1",
          pinName: t.name,
        },
      })),
    );
    expect(
      createDesignNetlistExport(result.project, { format: "spectre" }).status,
    ).toBe("ready");
    expect(
      createDesignNetlistExport(result.project, { format: "spice" }).status,
    ).toBe("blocked");
  });
  it("preserves the entire transaction when a process override or library identity is unproven", () => {
    for (const suffix of ["unknown=7", "nf=2"]) {
      const project = createEmptyProject("refused-process", "Refused process");
      const original = structuredClone(project);
      const source: ProjectModelSource = {
        id: "owner",
        revision: 0,
        language: "spice",
        entry: "mos.spice",
        dependencies:
          suffix === "nf=2"
            ? [
                {
                  id: "vendor",
                  mountPath: "vendor.lib",
                  sha256: "a".repeat(64),
                },
              ]
            : [],
        files: [
          {
            path: "mos.spice",
            text:
              ".subckt pair D G S B\nX1 D G S B sky130_fd_pr__nfet_01v8 w=2 l=0.15 " +
              suffix +
              "\n.ends pair\n",
          },
        ],
      };
      const result = executeProjectTransaction(project, {
        projectId: project.id,
        expectedStructureRevision: 0,
        transactionId: "refused",
        actor: { kind: "agent", id: "test" },
        edits: [
          {
            kind: "apply_model_source",
            source,
            definitions: [{ definitionId: "pair", entry: "pair" }],
            transform: { process: "sg13g2" },
          },
        ],
      });
      expect(result.ok).toBe(false);
      expect(project).toEqual(original);
    }
  });
  it("replaces reviewed source devices atomically with their pin roles, units and counts intact", () => {
    const project = createEmptyProject("process-owner", "Process owner");
    const source: ProjectModelSource = {
      id: "mos-owner",
      revision: 0,
      language: "spice",
      entry: "mos.spice",
      dependencies: [],
      files: [
        {
          path: "mos.spice",
          text: ".subckt pair D G S B\nX1 D G S B sky130_fd_pr__nfet_01v8 w=2 l=0.15 nf=2 m=8\n.ends pair\n",
        },
      ],
    };
    const result = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "process",
      actor: { kind: "agent", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source,
          definitions: [{ definitionId: "pair", entry: "pair" }],
          transform: { process: "sg13g2" },
        },
      ],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const text = result.project.modelSources![0]!.files[0]!.text;
    expect(text).toContain("X1 D G S B sg13_lv_nmos");
    expect(text).toContain("w=2u");
    expect(text).toContain("l=150n");
    expect(text).toContain("ng=2");
    expect(text).toContain("m=8");
    expect(
      result.project.externalSubcircuitDefinitions[0]!.terminals.map(
        (t) => t.name,
      ),
    ).toEqual(["D", "G", "S", "B"]);
    expect(source.files[0]!.text).toContain("sky130_fd_pr__nfet_01v8");
  });
  it("locates converted model output at its owner and refuses unverified reverse edits", () => {
    const p = createEmptyProject("mapped-spectre", "Mapped Spectre");
    const applied = executeProjectTransaction(p, {
      projectId: p.id,
      expectedStructureRevision: 0,
      transactionId: "mapped",
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "owner",
            revision: 0,
            language: "spectre",
            entry: "model.scs",
            dependencies: [],
            files: [
              {
                path: "model.scs",
                text: "subckt rc ()\nR1 (a 0) resistor r=1k\nends rc\n",
              },
            ],
          },
          definitions: [{ definitionId: "rc", entry: "rc" }],
        },
      ],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const project = applied.project;
    project.documents[0]!.instances.push(
      createExternalSubcircuitInstance(
        "X1",
        project.externalSubcircuitDefinitions[0]!,
        { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      ),
    );
    const out = createDesignNetlistExport(project, {
      format: "spice",
      includeLocations: true,
    });
    expect(out.status).toBe("ready");
    if (out.status !== "ready") return;
    expect(out.locations?.modelSources?.[0]?.sourceId).toBe("owner");
    const edit = planMappedProjectModelEdit(
      out.file.text,
      out.file.text.replace("R1 a 0 1000", "R1 a 0 2000"),
      out.locations!.modelSources!,
      project.modelSources!,
    );
    expect(edit).toMatchObject({
      matched: true,
      ok: false,
      code: "MODEL_SOURCE_EDIT_REQUIRES_OWNER",
    });
    expect(project.modelSources![0]!.files[0]!.text).toContain("r=1k");
  });
  it("rejects an unsupported model language boundary without losing its diagnostic", () => {
    const project = createEmptyProject(
      "unsupported-language",
      "Unsupported language",
    );
    const result = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "unsupported",
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "unsupported-source",
            revision: 0,
            language: "spectre",
            entry: "bad.scs",
            dependencies: [],
            files: [
              {
                path: "bad.scs",
                text: "simulator lang=veriloga\nsubckt fake ()\nends fake\n",
              },
            ],
          },
          definitions: [{ definitionId: "fake", entry: "fake" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("bad.scs:1");
    expect(project.externalSubcircuitDefinitions).toEqual([]);
  });
  it("retains a local device model's SPICE language when converting its external owner", () => {
    const project = createEmptyProject(
      "local-model-conversion",
      "Local model conversion",
    );
    const applied = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "clip",
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "clip-source",
            revision: 0,
            language: "spice",
            entry: "clip.spice",
            dependencies: [],
            files: [
              {
                path: "clip.spice",
                text: ".subckt clip A B\nD1 A B local\n.model local D (is=1e-14 n=1)\n.ends clip\n",
              },
            ],
          },
          definitions: [{ definitionId: "clip", entry: "clip" }],
          transform: { language: "spectre" },
        },
      ],
    });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    if (!applied.ok) return;
    const p = applied.project;
    p.documents[0]!.instances.push(
      createExternalSubcircuitInstance(
        "X1",
        p.externalSubcircuitDefinitions[0]!,
        { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      ),
    );
    for (const pinName of ["A", "B"])
      p.documents[0]!.noConnects.push({
        id: "nc-" + pinName,
        endpoint: { kind: "terminal", instanceId: "X1", pinName },
      });
    const output = createDesignNetlistExport(p, { format: "spice" });
    expect(output.status, JSON.stringify(output)).toBe("ready");
    if (output.status === "ready")
      expect(output.file.text).toContain(".model local D (is=1e-14 n=1)");
    expect(p.modelSources![0]!.files[0]!.text).toContain(
      "simulator lang=spice",
    );
  });
  it("converts an owned helper closure in one Apply and retains complete copy and simulation input", () => {
    const project = createEmptyProject(
      "helper-conversion",
      "Helper conversion",
    );
    const result = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "convert-helpers",
      actor: { kind: "agent", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "helpers",
            revision: 0,
            language: "spice",
            entry: "main.spice",
            dependencies: [],
            files: [
              {
                path: "main.spice",
                text: '.include "helpers/leaf.spice"\n.subckt outer\nX0 leaf\n.ends outer\n',
              },
              {
                path: "helpers/leaf.spice",
                text: ".subckt leaf\nR1 local 0 1k\n.ends leaf\n",
              },
            ],
          },
          definitions: [{ definitionId: "outer", entry: "outer" }],
          transform: { language: "spectre" },
        },
      ],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const next = result.project;
    expect(next.modelSources![0]!.language).toBe("spectre");
    expect(next.modelSources![0]!.files[0]!.text).toContain(
      'include "helpers/leaf.spice"',
    );
    next.documents[0]!.instances.push(
      createExternalSubcircuitInstance(
        "XTOP",
        next.externalSubcircuitDefinitions[0]!,
        { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      ),
    );
    for (const format of ["spice", "spectre"] as const) {
      const exported = createDesignNetlistExport(next, { format });
      expect(exported.status, JSON.stringify(exported)).toBe("ready");
      if (exported.status === "ready") {
        expect(exported.file.text).toMatch(
          format === "spice" ? /X0 leaf/ : /X0 \(\) leaf/,
        );
        expect(
          exported.file.text.match(
            format === "spice" ? /\.subckt leaf/g : /subckt leaf/g,
          ),
        ).toHaveLength(1);
        expect(exported.file.text).not.toContain(
          'include "helpers/leaf.spice"',
        );
      }
    }
  });
  it("applies a Spectre source once and exports both dialects without changing its native owner", () => {
    const project = createEmptyProject("spectre-owner", "Spectre owner");
    const text =
      "subckt rc (A B)\nparameters RVAL=1k\nR1 (A B) resistor r=RVAL\nends rc\n";
    const applied = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "spectre-apply",
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "spectre-source",
            revision: 0,
            language: "spectre",
            entry: "model.scs",
            files: [{ path: "model.scs", text }],
            dependencies: [],
          },
          definitions: [{ definitionId: "rc", entry: "rc" }],
        },
      ],
    });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    if (!applied.ok) return;
    const next = applied.project;
    const definition = next.externalSubcircuitDefinitions[0]!;
    expect(definition.terminals.map((t) => t.name)).toEqual(["A", "B"]);
    expect(definition.formalParameters).toEqual([
      { name: "RVAL", defaultValue: "1k" },
    ]);
    next.documents[0]!.instances.push(
      createExternalSubcircuitInstance("X1", definition, {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      }),
    );
    for (const pinName of ["A", "B"])
      next.documents[0]!.noConnects.push({
        id: "nc-" + pinName,
        endpoint: { kind: "terminal", instanceId: "X1", pinName },
      });
    const spice = createDesignNetlistExport(next, { format: "spice" });
    const spectre = createDesignNetlistExport(next, { format: "spectre" });
    expect(spice.status, JSON.stringify(spice)).toBe("ready");
    expect(spectre.status, JSON.stringify(spectre)).toBe("ready");
    if (spice.status === "ready")
      expect(spice.file.text).toContain(".subckt rc A B params: RVAL=1000");
    if (spectre.status === "ready") expect(spectre.file.text).toContain(text);
    expect(next.modelSources![0]!.files[0]!.text).toBe(text);
  });
  it("rejects custom artwork missing an added model port without applying any part of the batch", () => {
    const project = createEmptyProject("added-custom", "Added custom");
    const symbol = {
      ...structuredClone(builtInSymbols.find((s) => s.id === "resistor")!),
      id: "custom-amp",
    };
    project.componentDefinitions = [{ symbol }];
    const definition: ExternalSubcircuitDefinition = {
      id: "amp",
      name: "amp",
      interfaceStatus: "declared",
      formalParameters: [],
      terminals: symbol.pins.map((p) => ({
        id: p.name,
        name: p.name,
        direction: "passive",
      })),
    };
    project.externalSubcircuitDefinitions = [definition];
    const caller = createExternalSubcircuitInstance("X1", definition, {
      position: { x: 200, y: 200 },
      rotation: 0,
      mirror: "none",
    });
    caller.symbolId = symbol.id;
    project.documents[0]!.instances.push(caller);
    const original = structuredClone(project);
    const result = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "add-port",
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "body",
            revision: 0,
            language: "spice",
            entry: "amp.spice",
            files: [
              {
                path: "amp.spice",
                text: ".subckt amp A B C\nR1 A B 1k\n.ends amp\n",
              },
            ],
            dependencies: [],
          },
          definitions: [
            {
              definitionId: "amp",
              entry: "amp",
              portMap: { "1": "A", "2": "B" },
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected missing artwork refusal");
    expect(result.error.message).toContain("C");
    expect(result.error.message).toContain("artwork");
    expect(project).toEqual(original);
  });
  it("renames legacy custom pins atomically without moving artwork or unrelated callers", () => {
    const project = createEmptyProject("rename-custom", "Rename custom");
    const symbol = structuredClone(
      builtInSymbols.find((s) => s.id === "resistor")!,
    );
    symbol.id = "custom-amp";
    project.componentDefinitions = [{ symbol }];
    for (const id of ["amp", "other"])
      project.externalSubcircuitDefinitions.push({
        id,
        name: id,
        interfaceStatus: "declared",
        formalParameters: [],
        terminals: symbol.pins.map((p) => ({
          id: p.name,
          name: p.name,
          direction: "passive" as const,
        })),
      });
    const document = project.documents[0]!;
    for (const [id, definitionId] of [
      ["X1", "amp"],
      ["X2", "other"],
    ]) {
      document.instances.push({
        id: id!,
        reference: id!,
        symbolId: symbol.id,
        placement: {
          position: { x: 0, y: id === "X1" ? 0 : 200 },
          rotation: 0,
          mirror: "none",
        },
        netlist: {
          binding: { kind: "external-subcircuit", definitionId: definitionId! },
          parameters: { gain: "20" },
        },
      });
      document.nets.push({
        id: `${id}-net`,
        terminals: [{ instanceId: id!, pinName: "1" }],
      });
      document.noConnects.push({
        id: `${id}-nc`,
        endpoint: { kind: "terminal", instanceId: id!, pinName: "2" },
      });
    }
    const result = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "rename-custom",
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "source",
            language: "spice",
            entry: "amp.spice",
            revision: 0,
            dependencies: [],
            files: [
              {
                path: "amp.spice",
                text: ".subckt amp A B\nR1 A B 1k\n.ends amp\n",
              },
            ],
          },
          definitions: [
            {
              definitionId: "amp",
              entry: "amp",
              portMap: { "1": "A", "2": "B" },
            },
          ],
        },
      ],
    });
    expect(result.ok, JSON.stringify(result.ok ? null : result.error)).toBe(
      true,
    );
    if (!result.ok) return;
    const after = result.project.documents[0]!;
    const changed = after.instances[0]!;
    const renamed = createProjectSymbolResolver(
      result.project,
      builtInSymbols,
    ).resolve(changed.symbolId)!.definition;
    expect(renamed.primitives).toEqual(symbol.primitives);
    expect(
      renamed.pins.map((p) => ({ ...p, name: p.name === "A" ? "1" : "2" })),
    ).toEqual(symbol.pins);
    expect(changed.netlist).toEqual(document.instances[0]!.netlist);
    expect(after.nets[0]!.terminals[0]!.pinName).toBe("A");
    expect(after.noConnects[0]!.endpoint.pinName).toBe("B");
    expect(after.instances[1]).toEqual(document.instances[1]);
    expect(
      result.project.externalSubcircuitDefinitions[0]!.terminals.map(
        (t) => t.id,
      ),
    ).toEqual(["1", "2"]);
  });
  it("promotes a legacy model without replacing its custom caller artwork", () => {
    const project = createEmptyProject("legacy", "Legacy");
    const symbol = structuredClone(
      builtInSymbols.find((s) => s.id === "resistor")!,
    );
    symbol.id = "custom-amp";
    project.componentDefinitions = [{ symbol }];
    project.externalSubcircuitDefinitions.push({
      id: "amp",
      name: "amp",
      interfaceStatus: "declared",
      formalParameters: [],
      terminals: symbol.pins.map((p) => ({
        id: p.name,
        name: p.name,
        direction: "passive" as const,
      })),
    });
    project.documents[0]!.instances.push({
      id: "X1",
      reference: "X1",
      symbolId: symbol.id,
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "amp" },
        parameters: {},
      },
    });
    const result = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "promote",
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "source",
            language: "spice",
            entry: "amp.spice",
            revision: 0,
            dependencies: [],
            files: [
              {
                path: "amp.spice",
                text: ".subckt amp 1 2\nR1 1 2 1k\n.ends amp\n",
              },
            ],
          },
          definitions: [{ definitionId: "amp", entry: "amp" }],
        },
      ],
    });
    expect(result.ok, JSON.stringify(result.ok ? null : result.error)).toBe(
      true,
    );
    if (result.ok) {
      expect(result.project.documents).toEqual(project.documents);
      expect(
        createProjectSymbolResolver(result.project, builtInSymbols).resolve(
          symbol.id,
        )?.definition,
      ).toEqual(symbol);
    }
  });
  it("keeps caller wiring byte-for-byte when only the model body changes", () => {
    const initial = createEmptyProject("body-only", "Body only");
    const apply = (project: CircuitProject, value: string) =>
      executeProjectTransaction(project, {
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        transactionId: "apply-body",
        actor: { kind: "human", id: "test" },
        edits: [
          {
            kind: "apply_model_source",
            source: {
              id: "body-source",
              language: "spice",
              entry: "model.spice",
              files: [
                {
                  path: "model.spice",
                  text: `.subckt amp A B\nR1 A B ${value}\n.ends amp\n`,
                },
              ],
              dependencies: [],
              revision: project.modelSources?.[0]?.revision ?? 0,
            },
            definitions: [{ definitionId: "amp", entry: "amp" }],
          },
        ],
      });
    const first = apply(initial, "1k");
    if (!first.ok) throw Error(JSON.stringify(first.error));
    const project = first.project;
    const document = project.documents[0]!;
    document.instances.push(
      createExternalSubcircuitInstance(
        "X1",
        project.externalSubcircuitDefinitions[0]!,
        {
          position: { x: 200, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      ),
    );
    document.nets.push({
      id: "signal",
      terminals: [{ instanceId: "X1", pinName: "A" }],
    });
    document.junctions.push({
      id: "end",
      netId: "signal",
      position: { x: 0, y: 200 },
      role: "route-anchor",
    });
    document.routes.push(
      createRoutePath({
        id: "imported-wire",
        netId: "signal",
        start: { kind: "junction", junctionId: "end" },
        end: { kind: "terminal", instanceId: "X1", pinName: "A" },
        bends: [{ x: 80, y: 200 }],
        modes: ["manual", "manual"],
      }),
    );
    const before = structuredClone(document.routes);
    const updated = apply(project, "2k");
    expect(updated.ok, JSON.stringify(updated.ok ? null : updated.error)).toBe(
      true,
    );
    if (updated.ok)
      expect(updated.project.documents[0]!.routes).toEqual(before);
  });

  it.each(["ngspice", "vacask"] as const)(
    "ignores unincluded model bindings in %s execution and the active circuit view",
    (engine) => {
      const project = createEmptyProject("reachable", "Reachable");
      project.documents[0]!.instances.push({
        id: "R1",
        reference: "R1",
        symbolId: "resistor",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "1k" },
        },
      });
      project.documents[0]!.noConnects.push(
        ...["1", "2"].map((pinName) => ({
          id: `nc-${pinName}`,
          endpoint: { kind: "terminal" as const, instanceId: "R1", pinName },
        })),
      );
      const folder = createSimulationFolder({
        id: "sim",
        name: "Sim",
        engine,
        profileId: engine,
        documentId: project.topDocumentId,
      });
      const compile = () =>
        engine === "ngspice"
          ? compileNgspiceSourceSimulation(project, folder)
          : compileSourceSimulation(project, folder);
      const baseline = compile();
      expect(baseline.ok, JSON.stringify(baseline)).toBe(true);
      const unused = createEmptyProject("unused", "Unused").documents[0]!;
      unused.id = "unused-cell";
      unused.netlist!.name = "unused_cell";
      project.documents.push(unused);
      const definition: ExternalSubcircuitDefinition = {
        id: "unused-model",
        name: "unused_model",
        interfaceStatus: "declared",
        formalParameters: [],
        terminals: [{ id: "a", name: "A", direction: "passive" }],
        implementation: {
          kind: "source",
          sourceId: "unused-source",
          entry: "unused_model",
        },
      };
      project.modelSources = [
        {
          id: "unused-source",
          language: "spice",
          entry: "model.spice",
          revision: 1,
          dependencies: [],
          files: [
            {
              path: "model.spice",
              text: ".subckt unused_model A\nR1 A 0 1k\n.ends unused_model\n",
            },
          ],
        },
      ];
      project.externalSubcircuitDefinitions.push(definition);
      unused.instances.push(
        createExternalSubcircuitInstance("X_UNUSED", definition, {
          position: { x: 0, y: 0 },
          rotation: 0,
          mirror: "none",
        }),
      );
      folder.input.circuitBindings.push({
        ...folder.input.circuitBindings[0]!,
        id: "unused-binding",
        documentId: unused.id,
        path: engine === "ngspice" ? "unused.spice" : "unused.sim",
      });
      const actual = compile();
      expect(actual.ok, JSON.stringify(actual)).toBe(true);
      if (actual.ok && baseline.ok)
        expect(actual.files).toEqual(baseline.files);
      const preview = generateCircuitSource(
        project,
        folder.input.circuitBindings[0]!,
        folder.input,
        engine,
      );
      expect(preview.ok, JSON.stringify(preview)).toBe(true);
      if (preview.ok) expect(preview.source.text).not.toContain("unused_model");
      if (engine === "ngspice") {
        unused.noConnects.push({
          id: "unused-nc",
          endpoint: { kind: "terminal", instanceId: "X_UNUSED", pinName: "A" },
        });
        const entry = folder.input.files.find(
          (f) => f.path === folder.input.entry,
        )!;
        const original = entry.text;
        entry.text = entry.text.replace(
          ".control",
          '.include "unused.spice"\n.control',
        );
        const included = generateCircuitSource(
          project,
          folder.input.circuitBindings[0]!,
          folder.input,
          engine,
        );
        expect(included.ok, JSON.stringify(included)).toBe(true);
        if (included.ok) {
          expect(included.source.text).toContain("unused_model");
          const edit = planCircuitSourceEdit(
            included.source,
            included.source.text.replace("R1 A 0 1k", "R1 A 0 2k"),
          );
          expect(edit.ok, JSON.stringify(edit)).toBe(true);
          if (edit.ok) expect(edit.modelUpdates?.[0]?.id).toBe("unused-source");
          project.modelSources![0]!.draft = {
            entry: "model.spice",
            files: [{ path: "model.spice", text: ".subckt unfinished\n" }],
            baseRevision: 1,
          };
          const withDraft = generateCircuitSource(
            project,
            folder.input.circuitBindings[0]!,
            folder.input,
            engine,
          );
          expect(withDraft.ok).toBe(true);
          if (withDraft.ok) {
            const refused = planCircuitSourceEdit(
              withDraft.source,
              withDraft.source.text.replace("R1 A 0 1k", "R1 A 0 2k"),
            );
            expect(refused.ok).toBe(false);
            if (!refused.ok)
              expect(refused.message).toContain("saved model draft");
          }
        }
        entry.text = original;
      }
      definition.implementation = { kind: "placeholder" };
      expect(compile().ok).toBe(true);
    },
  );
  it.each([false, true])(
    "refuses conflicting global device models while retaining subcircuit-local scope (%s)",
    (local) => {
      let project = createEmptyProject("device-models", "Device models");
      for (const name of ["first", "second"]) {
        const card = `.model shared D(Is=${name === "first" ? "1e-14" : "1e-9"})\n`;
        const text = `${local ? "" : card}.subckt ${name} A B\n${local ? card : ""}D1 A B shared\n.ends ${name}\n`;
        const result = executeProjectTransaction(project, {
          projectId: project.id,
          expectedStructureRevision: project.structureRevision,
          transactionId: name,
          actor: { kind: "human", id: "test" },
          edits: [
            {
              kind: "apply_model_source",
              source: {
                id: name,
                language: "spice",
                entry: `${name}.spice`,
                revision: 0,
                dependencies: [],
                files: [{ path: `${name}.spice`, text }],
              },
              definitions: [{ definitionId: name, entry: name }],
            },
          ],
        });
        if (name === "second" && !local) {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.message).toContain("shared");
            expect(result.error.message).toContain("second.spice:1");
            expect(result.diagnostics).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  code: "MODEL_SOURCE_NAME_CONFLICT",
                  parameters: expect.objectContaining({
                    sourceId: "second",
                    revision: 1,
                    file: "second.spice",
                    line: 1,
                  }),
                }),
              ]),
            );
          }
          expect(project.modelSources).toHaveLength(1);
        } else {
          expect(result.ok, JSON.stringify(result)).toBe(true);
          if (result.ok) project = result.project;
        }
      }
    },
  );
  it("protects reviewed library implementations at the raw Project transaction boundary", () => {
    const project = createEmptyProject("reviewed", "Reviewed");
    const reviewed = reviewedExternalBindingForMaster(
      "sky130_fd_pr__nfet_01v8",
    )!;
    const definition = {
      id: "library",
      name: reviewed.masterName,
      terminals: reviewed.terminals.map((t, i) => ({
        id: `pin-${i}`,
        name: t.targetName,
        direction: "passive" as const,
      })),
      formalParameters: [],
      interfaceStatus: "declared" as const,
    };
    project.externalSubcircuitDefinitions.push(definition);
    const original = structuredClone(project);
    const replacement = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      transactionId: "replace-library",
      actor: { kind: "agent", id: "test" },
      edits: [
        {
          kind: "upsert_model_source",
          source: {
            id: "replacement",
            language: "spice",
            entry: "model.spice",
            revision: 1,
            files: [
              {
                path: "model.spice",
                text: `.subckt ${definition.name} ${definition.terminals.map((t) => t.name).join(" ")}\nR1 D S 1k\n.ends ${definition.name}\n`,
              },
            ],
            dependencies: [],
          },
        },
        {
          kind: "upsert_external_subcircuit_definition",
          definition: {
            ...definition,
            implementation: {
              kind: "source",
              sourceId: "replacement",
              entry: definition.name,
            },
          },
        },
      ],
    });
    expect(replacement.ok).toBe(false);
    if (!replacement.ok)
      expect(replacement.error.message).toContain("Reviewed");
    expect(project).toEqual(original);
  });

  it("updates multiple entries and callers atomically from one native source", () => {
    const initial = createEmptyProject("entries", "Entries");
    const source = {
      id: "models",
      language: "spice" as const,
      entry: "model.spice",
      files: [
        {
          path: "model.spice",
          text: ".subckt first A\nR1 A 0 1k\n.ends first\n.subckt second A\nR1 A 0 2k\n.ends second\n",
        },
      ],
      dependencies: [],
      revision: 0,
    };
    const request = (
      project: CircuitProject,
      source: ProjectModelSource,
      definitions: {
        definitionId: string;
        entry: string;
        portMap?: Record<string, string | null>;
      }[],
    ) =>
      executeProjectTransaction(project, {
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        transactionId: "entries",
        actor: { kind: "human", id: "test" },
        edits: [{ kind: "apply_model_source", source, definitions }],
      });
    const first = request(initial, source, [
      { definitionId: "first", entry: "first" },
      { definitionId: "second", entry: "second" },
    ]);
    if (!first.ok) throw Error(JSON.stringify(first));
    const project = first.project;
    for (const [
      i,
      definition,
    ] of project.externalSubcircuitDefinitions.entries()) {
      const instanceId = `X${i}`;
      project.documents[0]!.instances.push(
        createExternalSubcircuitInstance(instanceId, definition, {
          position: { x: i * 200, y: 0 },
          rotation: 0,
          mirror: "none",
        }),
      );
      project.documents[0]!.noConnects.push({
        id: `nc-${i}`,
        endpoint: { kind: "terminal", instanceId, pinName: "A" },
      });
    }
    const updated = request(
      project,
      {
        ...source,
        revision: 1,
        files: [
          {
            path: "model.spice",
            text: source.files[0]!.text.replaceAll(" A", " INPUT"),
          },
        ],
      },
      [
        { definitionId: "first", entry: "first", portMap: { A: "INPUT" } },
        { definitionId: "second", entry: "second", portMap: { A: "INPUT" } },
      ],
    );
    expect(updated.ok, JSON.stringify(updated)).toBe(true);
    if (updated.ok)
      expect(
        updated.project.documents[0]!.noConnects.map((n) => n.endpoint.pinName),
      ).toEqual(["INPUT", "INPUT"]);
  });
  it("keeps invalid drafts out of executable bytes and rejects stale Apply atomically", () => {
    const project = createEmptyProject("draft", "Draft");
    const source = {
      id: "model",
      language: "spice" as const,
      entry: "model.spice",
      files: [
        { path: "model.spice", text: ".subckt amp A\nR1 A 0 1k\n.ends amp\n" },
      ],
      dependencies: [],
      revision: 0,
    };
    const transact = (project: CircuitProject, edits: ProjectStructureEdit[]) =>
      executeProjectTransaction(project, {
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        transactionId: "draft",
        actor: { kind: "agent", id: "test" },
        edits,
      });
    const first = transact(project, [
      {
        kind: "apply_model_source",
        source,
        definitions: [{ definitionId: "amp", entry: "amp" }],
      },
    ]);
    if (!first.ok) throw Error(JSON.stringify(first));
    const saved = transact(first.project, [
      {
        kind: "save_model_source_draft",
        sourceId: "model",
        expectedRevision: 1,
        entry: "model.spice",
        files: [{ path: "model.spice", text: ".subckt broken" }],
        dependencies: [],
      },
    ]);
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    if (!saved.ok) return;
    expect(saved.project.modelSources?.[0]?.files[0]?.text).toBe(
      source.files[0]!.text,
    );
    expect(saved.project.modelSources?.[0]?.draft?.files[0]?.text).toBe(
      ".subckt broken",
    );
    const before = structuredClone(saved.project);
    expect(
      transact(saved.project, [
        {
          kind: "apply_model_source",
          source,
          definitions: [{ definitionId: "amp", entry: "amp" }],
        },
      ]).ok,
    ).toBe(false);
    expect(saved.project).toEqual(before);
    const bypass = transact(first.project, [
      {
        kind: "upsert_model_source",
        source: {
          ...first.project.modelSources![0]!,
          files: [
            {
              path: "model.spice",
              text: source.files[0]!.text.replace("1k", "9k"),
            },
          ],
        },
      },
    ]);
    expect(bypass.ok).toBe(false);
    first.project.documents[0]!.instances.push(
      createExternalSubcircuitInstance(
        "X1",
        first.project.externalSubcircuitDefinitions[0]!,
        { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      ),
    );
    saved.project.documents[0]!.instances = structuredClone(
      first.project.documents[0]!.instances,
    );
    first.project.documents[0]!.noConnects.push({
      id: "nc",
      endpoint: { kind: "terminal", instanceId: "X1", pinName: "A" },
    });
    saved.project.documents[0]!.noConnects = structuredClone(
      first.project.documents[0]!.noConnects,
    );
    const folder = createSimulationFolder({
      id: "sim",
      name: "Simulation",
      profileId: "test",
      engine: "ngspice",
      documentId: first.project.documents[0]!.id,
    });
    const baseline = compileNgspiceSourceSimulation(first.project, folder);
    const drafted = compileNgspiceSourceSimulation(saved.project, folder);
    expect(
      baseline.ok && drafted.ok,
      JSON.stringify({ baseline, drafted }),
    ).toBe(true);
    if (baseline.ok && drafted.ok) {
      expect(drafted.files).toEqual(baseline.files);
      expect(drafted.electricalHash).toBe(baseline.electricalHash);
      expect(
        drafted.warnings.some((d) => d.code === "MODEL_SOURCE_DRAFT_PENDING"),
      ).toBe(true);
    }
  });
  it("preserves wired port identity across reorder and requires explicit rename or disconnection", () => {
    const initial = createEmptyProject("migration", "Migration");
    const apply = (
      project: typeof initial,
      ports: string,
      portMap?: Record<string, string | null>,
    ) =>
      executeProjectTransaction(project, {
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        transactionId: "apply",
        actor: { kind: "human", id: "test" },
        edits: [
          {
            kind: "apply_model_source",
            source: {
              id: "model",
              language: "spice",
              entry: "model.spice",
              files: [
                {
                  path: "model.spice",
                  text: `.subckt amp ${ports}\nR1 A 0 1k\n.ends amp\n`,
                },
              ],
              dependencies: [],
              revision: project.modelSources?.[0]?.revision ?? 0,
            },
            definitions: [
              {
                definitionId: "amp",
                entry: "amp",
                ...(portMap ? { portMap } : {}),
              },
            ],
          },
        ],
      });
    const first = apply(initial, "A B");
    if (!first.ok) throw Error(JSON.stringify(first));
    const project = first.project;
    const definition = project.externalSubcircuitDefinitions[0]!;
    const pinId = definition.terminals[0]!.id;
    const doc = project.documents[0]!;
    doc.instances.push(
      createExternalSubcircuitInstance("X1", definition, {
        position: { x: 200, y: 200 },
        rotation: 0,
        mirror: "none",
      }),
    );
    doc.nets.push({
      id: "signal",
      terminals: [{ instanceId: "X1", pinName: "A" }],
    });
    doc.junctions.push({
      id: "wire-end",
      netId: "signal",
      position: { x: 0, y: 200 },
      role: "route-anchor",
    });
    doc.routes.push(
      createRoutePath({
        id: "wire",
        netId: "signal",
        start: { kind: "junction", junctionId: "wire-end" },
        end: { kind: "terminal", instanceId: "X1", pinName: "A" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const reordered = apply(project, "B A");
    expect(reordered.ok, JSON.stringify(reordered)).toBe(true);
    if (!reordered.ok) return;
    expect(
      reordered.project.externalSubcircuitDefinitions[0]!.terminals[1]!.id,
    ).toBe(pinId);
    expect(reordered.project.documents[0]!.nets[0]!.terminals).toEqual(
      doc.nets[0]!.terminals,
    );
    expect(apply(reordered.project, "B INPUT").ok).toBe(false);
    const renamed = apply(reordered.project, "B INPUT", { A: "INPUT" });
    expect(renamed.ok, JSON.stringify(renamed)).toBe(true);
    if (!renamed.ok) return;
    expect(
      renamed.project.externalSubcircuitDefinitions[0]!.terminals[1]!.id,
    ).toBe(pinId);
    expect(routeEnd(renamed.project.documents[0]!.routes[0]!)).toMatchObject({
      kind: "terminal",
      pinName: "INPUT",
    });
    const detached = apply(renamed.project, "B", { INPUT: null });
    expect(detached.ok, JSON.stringify(detached)).toBe(true);
    if (!detached.ok) return;
    expect(detached.project.documents[0]!.routes).toHaveLength(1);
    expect(routeEnd(detached.project.documents[0]!.routes[0]!).kind).toBe(
      "junction",
    );
    expect(
      detached.project.documents[0]!.nets.flatMap((n) => n.terminals),
    ).toEqual([]);
  });
  it("transfers a Cell's owned model implementation through the real import transaction", () => {
    const source = createEmptyProject("source-project", "Source");
    const defined = executeProjectTransaction(source, {
      projectId: source.id,
      expectedStructureRevision: 0,
      transactionId: "define",
      actor: { kind: "human", id: "local" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "owned-source",
            language: "spice",
            entry: "owned.spice",
            files: [
              {
                path: "owned.spice",
                text: ".subckt owned A B\nR1 A B 7k\n.ends owned\n",
              },
            ],
            dependencies: [],
            revision: 0,
          },
          definitions: [{ definitionId: "owned", entry: "owned" }],
        },
      ],
    });
    if (!defined.ok) throw new Error(JSON.stringify(defined));
    const project = defined.project;
    const definition = project.externalSubcircuitDefinitions[0]!;
    const document = project.documents[0]!;
    document.instances.push(
      createExternalSubcircuitInstance("X1", definition, {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      }),
    );
    document.noConnects.push(
      ...definition.terminals.map((pin) => ({
        id: `nc-${pin.name}`,
        endpoint: {
          kind: "terminal" as const,
          instanceId: "X1",
          pinName: pin.name,
        },
      })),
    );
    const destination = createEmptyProject(
      "destination-project",
      "Destination",
    );
    const plan = planProjectCellImport(destination, project, document.id);
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    if (!plan.ok || plan.status === "already-imported") return;
    const imported = executeProjectTransaction(destination, {
      projectId: destination.id,
      expectedStructureRevision: 0,
      transactionId: "import",
      actor: { kind: "human", id: "local" },
      edits: [...plan.edits],
    });
    expect(imported.ok, JSON.stringify(imported)).toBe(true);
    if (!imported.ok) return;
    const output = createDesignNetlistExport(imported.project, {
      rootDocumentId: plan.rootDocumentId,
    });
    expect(output.status, JSON.stringify(output)).toBe("ready");
    if (output.status === "ready")
      expect(output.file.text).toContain("R1 A B 7k");
    expect(imported.project.modelSources).toHaveLength(1);
  });
  it("includes the portable helper-file closure once instead of exporting a browser-only path", () => {
    const initial = createEmptyProject("helper-model", "Helper model");
    const helper =
      "* exact helper comment\n.subckt model_helper A B\nR1 A B 1k\n.ends model_helper\n";
    const text =
      '.include "helper.spice"\n.subckt composite A B\nXHELP A B model_helper\n.ends composite\n';
    const result = executeProjectTransaction(initial, {
      projectId: initial.id,
      expectedStructureRevision: 0,
      transactionId: "helper",
      actor: { kind: "agent", id: "agent" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "source",
            language: "spice",
            entry: "main.spice",
            files: [
              { path: "main.spice", text },
              { path: "helper.spice", text: helper },
            ],
            dependencies: [],
            revision: 0,
          },
          definitions: [{ definitionId: "composite", entry: "composite" }],
        },
      ],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const project = result.project;
    const definition = project.externalSubcircuitDefinitions[0]!;
    const document = project.documents[0]!;
    document.instances.push(
      createExternalSubcircuitInstance("X1", definition, {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      }),
    );
    document.noConnects.push(
      ...definition.terminals.map((pin) => ({
        id: `nc-${pin.name}`,
        endpoint: {
          kind: "terminal" as const,
          instanceId: "X1",
          pinName: pin.name,
        },
      })),
    );
    const output = createDesignNetlistExport(project);
    expect(output.status, JSON.stringify(output)).toBe("ready");
    if (output.status !== "ready") return;
    expect(output.file.text).toContain(helper.trim());
    expect(output.file.text).not.toContain('.include "helper.spice"');
    expect(output.file.text.match(/\.subckt model_helper\b/gu)).toHaveLength(1);
    const simulation = compileNgspiceSourceSimulation(
      project,
      createSimulationFolder({
        id: "sim",
        name: "Simulation",
        profileId: "test",
        engine: "ngspice",
        documentId: document.id,
      }),
    );
    expect(simulation.ok, JSON.stringify(simulation)).toBe(true);
    if (simulation.ok)
      expect(simulation.files.map((f) => f.text).join("\n")).toContain(
        helper.trim(),
      );
  });
  it("applies one behavioral definition used by design export and source simulation", () => {
    const initial = createEmptyProject("owned-model", "Owned model");
    const text = [
      ".subckt booster INP INN OUT VSS params: gain=20",
      "BOUT OUT VSS V={gain*(v(INP,VSS)-v(INN,VSS))}",
      ".ends booster",
      "",
    ].join("\n");
    const applied = executeProjectTransaction(initial, {
      projectId: initial.id,
      expectedStructureRevision: initial.structureRevision,
      transactionId: "define",
      actor: { kind: "human", id: "local" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "booster-source",
            language: "spice",
            entry: "booster.spice",
            files: [{ path: "booster.spice", text }],
            dependencies: [],
            revision: 0,
          },
          definitions: [
            { definitionId: "booster-definition", entry: "booster" },
          ],
        },
      ],
    });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    if (!applied.ok) return;
    expect(applied.applied).toBe(true);
    const project = applied.project;
    const definition = project.externalSubcircuitDefinitions[0]!;
    expect(definition.terminals.map((pin) => pin.name)).toEqual([
      "INP",
      "INN",
      "OUT",
      "VSS",
    ]);
    const document = project.documents[0]!;
    document.instances.push(
      createExternalSubcircuitInstance("X1", definition, {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      }),
    );
    document.noConnects.push(
      ...definition.terminals.map((pin) => ({
        id: `nc-${pin.name}`,
        endpoint: {
          kind: "terminal" as const,
          instanceId: "X1",
          pinName: pin.name,
        },
      })),
    );
    const direct = createDesignNetlistExport(project, {
      format: "spice",
      includeLocations: true,
    });
    expect(direct.status, JSON.stringify(direct)).toBe("ready");
    if (direct.status !== "ready") return;
    expect(direct.file.text).toContain(text.trim());
    for (const field of direct.locations.fields)
      expect(direct.file.text.slice(field.startOffset, field.endOffset)).toBe(
        field.rawValue,
      );
    expect(direct.locations.modelSources?.[0]?.sourceId).toBe("booster-source");
    const folder = createSimulationFolder({
      id: "sim",
      name: "Simulation",
      profileId: "ngspice-test",
      engine: "ngspice",
      documentId: document.id,
    });
    const simulation = compileNgspiceSourceSimulation(project, folder);
    expect(simulation.ok, JSON.stringify(simulation)).toBe(true);
    if (!simulation.ok) return;
    const models = simulation.files.map((file) => file.text).join("\n");
    expect(models).toContain(text.trim());
    expect(models.match(/\.subckt booster\b/gu)).toHaveLength(1);
    expect(
      simulation.sourceMaps
        .flatMap((f) => f.segments)
        .some(
          (s) =>
            s.origin.kind === "model-source" &&
            s.origin.sourceId === "booster-source",
        ),
    ).toBe(true);
    const converted = createDesignNetlistExport(project, { format: "spectre" });
    expect(converted.status).toBe("blocked");
    expect(
      converted.diagnostics.find((d) => d.code === "MODEL_SOURCE_DIALECT")
        ?.message,
    ).toContain("booster.spice");
    expect(
      converted.diagnostics.some((d) => d.code === "MODEL_SOURCE_DIALECT"),
    ).toBe(true);
    folder.input.files.find((f) => f.path === folder.input.entry)!.text =
      folder.input.files
        .find((f) => f.path === folder.input.entry)!
        .text.replace(".control", text + ".control");
    const shadow = compileNgspiceSourceSimulation(project, folder);
    expect(shadow.ok).toBe(false);
    if (!shadow.ok)
      expect(
        shadow.diagnostics.some(
          (d) =>
            d.code === "MODEL_SOURCE_SHADOW" &&
            d.path === folder.input.entry &&
            d.sourceRef,
        ),
      ).toBe(true);
    const placeholder = structuredClone(project);
    placeholder.externalSubcircuitDefinitions[0]!.implementation = {
      kind: "placeholder",
    };
    const unresolved = compileNgspiceSourceSimulation(
      placeholder,
      createSimulationFolder({
        id: "missing",
        name: "Missing",
        engine: "ngspice",
        profileId: "test",
        documentId: document.id,
      }),
    );
    expect(unresolved.ok).toBe(false);
    if (!unresolved.ok)
      expect(
        unresolved.diagnostics.some(
          (d) => d.code === "MODEL_IMPLEMENTATION_MISSING",
        ),
      ).toBe(true);
  });
});
