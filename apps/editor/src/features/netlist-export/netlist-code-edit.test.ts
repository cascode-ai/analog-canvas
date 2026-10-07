import { describe, it, expect } from "vitest";
import { importSpiceSources } from "@icm/spice";
import { createDesignNetlistExport, type NetlistFormat } from "@icm/netlist";
import { executeProjectTransaction } from "@icm/edit-engine";
import { createExternalSubcircuitInstance } from "@icm/edit-engine";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import {
  generateCircuitSource,
  planCircuitSourceEdit,
  compileNgspiceSourceSimulation,
} from "@icm/netlist";
import {
  planNetlistCodeEdit,
  netlistInstanceAtLine,
  netlistInstanceRanges,
  createNetlistCodeEditSession,
} from "./netlist-code-edit";

it("writes a mapped model-body edit to the shared owner used by every experiment", () => {
  const initial = createEmptyProject("model-edit", "Model edit");
  const apply = executeProjectTransaction(initial, {
    projectId: initial.id,
    expectedStructureRevision: 0,
    transactionId: "define",
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "apply_model_source",
        source: {
          id: "model",
          language: "spice",
          entry: "model.spice",
          revision: 0,
          dependencies: [],
          files: [
            {
              path: "model.spice",
              text: ".subckt amp A B params: gain=2\nB1 B 0 V={gain*v(A)}\n.ends amp\n",
            },
          ],
        },
        definitions: [{ definitionId: "amp", entry: "amp" }],
      },
    ],
  });
  if (!apply.ok) throw Error(JSON.stringify(apply));
  const project = apply.project;
  const doc = project.documents[0]!;
  const definition = project.externalSubcircuitDefinitions[0]!;
  doc.instances.push(
    createExternalSubcircuitInstance("X1", definition, {
      position: { x: 0, y: 0 },
      rotation: 0,
      mirror: "none",
    }),
  );
  doc.noConnects.push(
    ...definition.terminals.map((t) => ({
      id: "nc-" + t.id,
      endpoint: {
        kind: "terminal" as const,
        instanceId: "X1",
        pinName: t.name,
      },
    })),
  );
  const baseline = createDesignNetlistExport(project, {
    includeLocations: true,
  });
  if (baseline.status !== "ready") throw Error(JSON.stringify(baseline));
  const changed = baseline.file.text.replace("gain*v(A)", "3*gain*v(A)");
  const planned = planNetlistCodeEdit(project, baseline, changed);
  expect(planned.ok, JSON.stringify(planned)).toBe(true);
  if (!planned.ok) return;
  const updated = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    transactionId: "edit-model",
    actor: { kind: "human", id: "test" },
    edits: planned.edits,
  });
  expect(updated.ok, JSON.stringify(updated)).toBe(true);
  if (!updated.ok) return;
  expect(updated.project.modelSources?.[0]?.files[0]?.text).toContain(
    "3*gain*v(A)",
  );
  for (const id of ["op", "ac"]) {
    const folder = createSimulationFolder({
      id,
      name: id,
      profileId: "test",
      engine: "ngspice",
      documentId: doc.id,
    });
    const compiled = compileNgspiceSourceSimulation(updated.project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    const view = generateCircuitSource(
      updated.project,
      folder.input.circuitBindings[0]!,
      folder.input,
      "ngspice",
    );
    expect(view.ok, JSON.stringify(view)).toBe(true);
    if (!view.ok) return;
    expect(view.source.text).toContain("3*gain*v(A)");
    const mapped = planCircuitSourceEdit(
      view.source,
      view.source.text.replace("3*gain", "4*gain"),
    );
    expect(mapped.ok, JSON.stringify(mapped)).toBe(true);
    if (mapped.ok)
      expect(mapped.modelUpdates?.[0]?.files[0]?.text).toContain("4*gain");
    expect(
      planCircuitSourceEdit(
        view.source,
        view.source.text.replace("amp A B", "amp B A"),
      ).ok,
    ).toBe(false);
  }
});

async function fixture(format: NetlistFormat) {
  const imported = await importSpiceSources(
    [
      {
        path: "test.spi",
        bytes: new TextEncoder().encode(`
.model NMOS NMOS (level=1)
.subckt leaf A B
R1 A B 10k
M1 A B B B NMOS w=1u l=150n
.ends leaf
.subckt top A B
R1 A B 20k
X1 A B leaf
.ends top
`),
      },
    ],
    "test.spi",
  );
  expect(imported.successful, JSON.stringify(imported.diagnostics)).toBe(true);
  const project = imported.project!;
  const baseline = createDesignNetlistExport(project, {
    format,
    includeLocations: true,
  });
  if (baseline.status !== "ready") throw new Error(JSON.stringify(baseline));
  return { project, baseline };
}

it("refuses a value SPICE would read as milli, and the export warns of a stored one (#1409)", async () => {
  const { project, baseline } = await fixture("spice");
  const plan = planNetlistCodeEdit(
    project,
    baseline,
    baseline.file.text.replace("10k", "1Mohm"),
  );
  expect(plan).toMatchObject({
    ok: false,
    message: expect.stringContaining("(M is milli): write 1Megohm for mega"),
  });

  const stored = structuredClone(project);
  const resistor = stored.documents
    .flatMap((document) => document.instances)
    .find((instance) => instance.netlist?.parameters.value === "10k")!;
  resistor.netlist!.parameters.value = "1MΩ";
  const exported = createDesignNetlistExport(stored);
  expect(exported.status).toBe("ready");
  expect(exported.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "MILLI_SCALE_VALUE",
      severity: "warning",
      objectIds: [resistor.id],
    }),
  );
});

it("shares draft analysis across selection and apply, and fences a replacement snapshot", async () => {
  const { project, baseline } = await fixture("spice");
  const session = createNetlistCodeEditSession(project, baseline);
  const draft = baseline.file.text.replace("10k", "33k");
  const before = structuredClone(project);
  const focused = session.analyze(draft);
  expect(focused.ok).toBe(true);
  expect(session.analyze(draft)).toBe(focused);
  const plan = session.plan(draft);
  if (!plan.ok || !focused.ok) throw new Error("Expected valid draft");
  expect(plan.instances).toBe(focused.instances);
  expect(plan).toEqual(planNetlistCodeEdit(project, baseline, draft));
  expect(project).toEqual(before);
  expect(session.analyze(draft.replace("33k", ""))).toMatchObject({
    ok: false,
  });
  expect(session.plan(draft)).toEqual(plan);
  const committed = executeProjectTransaction(project, {
    transactionId: "session",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: plan.edits,
  });
  if (!committed.ok) throw new Error(committed.error.message);
  const next = createDesignNetlistExport(committed.project, {
    format: "spice",
    includeLocations: true,
  });
  if (next.status !== "ready") throw new Error(JSON.stringify(next));
  expect(
    createNetlistCodeEditSession(committed.project, next).plan(next.file.text),
  ).toMatchObject({ ok: true, edits: [] });
  const stale = executeProjectTransaction(committed.project, {
    transactionId: "stale",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: plan.edits,
  });
  expect(stale.ok).toBe(false);
});

it.each<NetlistFormat>(["spice", "spectre"])(
  "edits a large %s netlist without compiling a document-wide regexp",
  async (format) => {
    const count = 600;
    const imported = await importSpiceSources(
      [
        {
          path: "large.spi",
          bytes: new TextEncoder().encode(
            [
              ".model NMOS NMOS (level=1)",
              ".subckt dut D G S B",
              ...Array.from(
                { length: count },
                (_, i) => `M${i + 1} D G S B NMOS w=1u l=150n nf=1 m=1`,
              ),
              ".ends dut",
            ].join("\n"),
          ),
        },
      ],
      "large.spi",
    );
    expect(imported.successful).toBe(true);
    const project = imported.project!;
    const baseline = createDesignNetlistExport(project, {
      format,
      includeLocations: true,
    });
    if (baseline.status !== "ready") throw new Error("Expected ready export");
    expect(baseline.locations.instances).toHaveLength(count);
    const last = baseline.locations.fields.find(
      (field) =>
        field.kind === "parameter" &&
        field.parameter === "w" &&
        field.instanceId === baseline.locations.instances.at(-1)!.instanceId,
    )!;
    const source =
      baseline.file.text.slice(0, last.startOffset) +
      "20u" +
      baseline.file.text.slice(last.endOffset);
    const before = structuredClone(project);
    const plan = planNetlistCodeEdit(project, baseline, source);
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0]).toMatchObject({
      kind: "transact_document",
      edits: [
        {
          kind: "bulk_patch_instance_netlist",
          assignments: [{ instanceId: last.instanceId, set: { w: "20u" } }],
        },
      ],
    });
    expect(
      netlistInstanceAtLine(source, source.indexOf("w=20u"), plan.instances)
        ?.instanceId,
    ).toBe(last.instanceId);
    expect(project).toEqual(before);
    const result = executeProjectTransaction(project, {
      transactionId: "large-netlist-edit",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: plan.edits,
    });
    expect(result.ok).toBe(true);
    expect(
      planNetlistCodeEdit(
        project,
        baseline,
        source.replace("D G S B", "D BAD S B"),
      ).ok,
    ).toBe(false);
  },
);

it("maps wrapped SPICE parameter lines after title removal", async () => {
  const { project } = await fixture("spice");
  const mos = project.documents
    .find((d) => d.netlist?.name === "leaf")!
    .instances.find((i) => i.reference === "M1")!;
  mos.netlist!.parameters.extra_parameter_with_a_long_name =
    "1234567890123456789012345678901234567890123456789012345678901234567890";
  const baseline = createDesignNetlistExport(project, {
    format: "spice",
    includeLocations: true,
  });
  if (baseline.status !== "ready") throw new Error("Expected printable source");
  const continuation = baseline.file.text.indexOf("\n+ ");
  expect(continuation).toBeGreaterThan(0);
  const mapped = netlistInstanceAtLine(
    baseline.file.text,
    continuation + 3,
    baseline.locations.instances,
  );
  expect(mapped?.instanceId).toBe(mos.id);
  const changed = baseline.file.text.replace("w=1u", "w=20u");
  const plan = planNetlistCodeEdit(project, baseline, changed);
  expect(plan.ok).toBe(true);
  if (plan.ok)
    expect(
      netlistInstanceAtLine(
        changed,
        changed.indexOf("\n+ ") + 3,
        plan.instances,
      )?.instanceId,
    ).toBe(mos.id);
});

it("finds where a Cell's selected parts are printed, not a namesake in another Cell", async () => {
  const { project, baseline } = await fixture("spice");
  const cell = (name: string) =>
    project.documents.find((d) => d.netlist?.name === name)!;
  const leaf = cell("leaf");
  const top = cell("top");
  const r1 = (document: typeof leaf) =>
    document.instances.find((i) => i.reference === "R1")!.id;
  const text = baseline.file.text;
  const [inLeaf] = netlistInstanceRanges(
    baseline.locations.instances,
    leaf.id,
    [r1(leaf)],
  );
  expect(text.slice(inLeaf!.from, inLeaf!.to)).toMatch(/^R1 A B 10k/u);
  const [inTop] = netlistInstanceRanges(baseline.locations.instances, top.id, [
    r1(top),
  ]);
  expect(text.slice(inTop!.from, inTop!.to)).toMatch(/^R1 A B 20k/u);
  expect(
    netlistInstanceRanges(
      baseline.locations.instances,
      leaf.id,
      leaf.instances.map((i) => i.id),
    ),
  ).toHaveLength(2);
  expect(
    netlistInstanceRanges(baseline.locations.instances, top.id, ["missing"]),
  ).toEqual([]);
});

describe.each<NetlistFormat>(["spice", "spectre"])(
  "%s netlist editing",
  (format) => {
    it("retains expression edits and absolute card ranges with CRLF, blanks and indentation", async () => {
      const { project, baseline } = await fixture(format);
      const source =
        "\r\n" +
        baseline.file.text
          .replace("10k", "{20k + 10k}")
          .split("\n")
          .map((line) => `\t${line}  `)
          .join("\r\n\r\n") +
        "\r\n";
      const plan = planNetlistCodeEdit(project, baseline, source);
      if (!plan.ok) throw new Error(plan.message);
      expect(plan.edits).toMatchObject([
        {
          kind: "transact_document",
          edits: [
            {
              kind: "bulk_patch_instance_netlist",
              assignments: [{ set: { value: "{20k + 10k}" } }],
            },
          ],
        },
      ]);
      expect(plan.instances).toHaveLength(baseline.locations.instances.length);
      for (const range of plan.instances) {
        const reference = project.documents
          .find((d) => d.id === range.documentId)!
          .instances.find((i) => i.id === range.instanceId)!.reference!;
        expect(source.slice(range.startOffset)).toMatch(
          new RegExp(`^${reference} `),
        );
        expect(
          netlistInstanceAtLine(source, range.startOffset + 1, plan.instances),
        ).toEqual(range);
      }
      expect(
        planNetlistCodeEdit(
          project,
          baseline,
          baseline.file.text.replace("10k", "10\nk"),
        ).ok,
      ).toBe(false);
    });
    it("maps each printed card and cursor line to stable Cell/instance IDs", async () => {
      const { project, baseline } = await fixture(format);
      expect(baseline.locations.instances).toHaveLength(4);
      for (const range of baseline.locations.instances) {
        const instance = project.documents
          .find((d) => d.id === range.documentId)!
          .instances.find((i) => i.id === range.instanceId)!;
        expect(
          baseline.file.text.slice(range.startOffset, range.endOffset),
        ).toMatch(new RegExp(`^${instance.reference} `));
        expect(
          netlistInstanceAtLine(
            baseline.file.text,
            range.endOffset,
            baseline.locations.instances,
          ),
        ).toEqual(range);
      }
      expect(
        netlistInstanceAtLine(
          baseline.file.text,
          baseline.file.text.indexOf("subckt"),
          baseline.locations.instances,
        ),
      ).toBeNull();
    });
    it("renames and edits values/models in the right Cell without replacing geometry", async () => {
      const { project, baseline } = await fixture(format);
      const source = baseline.file.text
        .replace("R1 ", "R_load ")
        .replace("10k", "33k")
        .replace("NMOS", "N_FAST")
        .replace("w=1u", "w=2u");
      const plan = planNetlistCodeEdit(project, baseline, source);
      if (!plan.ok) throw new Error(plan.message);
      const result = executeProjectTransaction(project, {
        transactionId: "netlist",
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: plan.edits,
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
      const leaf = result.project.documents.find(
        (d) => d.netlist?.name === "leaf",
      )!;
      const top = result.project.documents.find(
        (d) => d.netlist?.name === "top",
      )!;
      expect(
        leaf.instances.find((i) => i.reference === "R_load")!.netlist!
          .parameters.value,
      ).toBe("33k");
      expect(top.instances.find((i) => i.reference === "R1")).toBeDefined();
      expect(
        leaf.instances.find((i) => i.reference === "M1")!.netlist,
      ).toMatchObject({ binding: { name: "N_FAST" }, parameters: { w: "2u" } });
      for (const document of result.project.documents) {
        const before = project.documents.find((d) => d.id === document.id)!;
        expect(document.routes).toEqual(before.routes);
        expect(document.instances.map((i) => [i.id, i.placement])).toEqual(
          before.instances.map((i) => [i.id, i.placement]),
        );
      }
      const field = plan.instances.find((range) =>
        source.slice(range.startOffset, range.endOffset).startsWith("R_load "),
      )!;
      expect(
        netlistInstanceAtLine(
          source,
          source.indexOf("R_load") + 2,
          plan.instances,
        ),
      ).toEqual(field);
    });
    it("refuses topology changes and incomplete drafts without mutating the project", async () => {
      const { project, baseline } = await fixture(format);
      const before = structuredClone(project);
      expect(
        planNetlistCodeEdit(
          project,
          baseline,
          baseline.file.text.replace(/R1 (?:\()?A/u, "R1 Z"),
        ).ok,
      ).toBe(false);
      expect(
        planNetlistCodeEdit(
          project,
          baseline,
          baseline.file.text.replace("10k", ""),
        ).ok,
      ).toBe(false);
      expect(project).toEqual(before);
    });
    it("validates prefixes through the atomic edit boundary", async () => {
      const { project, baseline } = await fixture(format);
      const plan = planNetlistCodeEdit(
        project,
        baseline,
        baseline.file.text.replace("R1 ", "M1 "),
      );
      if (!plan.ok) throw new Error(plan.message);
      const before = structuredClone(project);
      const result = executeProjectTransaction(project, {
        transactionId: "invalid",
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: plan.edits,
      });
      expect(result.ok).toBe(false);
      expect(project).toEqual(before);
    });
  },
);

it.each([
  ["spice", "XM_load", "M_load", false],
  ["spectre", "M_load", "M_load", false],
  ["spice", "X_load", "X_load", false],
  ["spice", "XM_load_2", "M_load", true],
] as const)(
  "maps a %s rename to %s back to %s (collision: %s)",
  async (format, printedName, authoredName, collision) => {
    const { project } = await fixture(format);
    const { planSetDeviceModelTarget } = await import("@icm/edit-engine");
    const leaf = project.documents.find((d) => d.netlist?.name === "leaf")!;
    const mos = leaf.instances.find((i) => i.reference === "M1")!;
    const mapped = executeProjectTransaction(project, {
      transactionId: "sky130",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetDeviceModelTarget(
        project,
        leaf.id,
        mos.id,
        "sky130_fd_pr__nfet_01v8",
      ),
    });
    if (!mapped.ok) throw new Error(mapped.error.message);
    if (collision) {
      const document = mapped.project.documents.find((d) => d.id === leaf.id)!;
      document.instances.push({
        ...structuredClone(document.instances.find((i) => i.id === mos.id)!),
        id: "existing-x",
        reference: "XM1",
        placement: null,
      });
      for (const pinName of ["D", "G", "S", "B"])
        document.noConnects.push({
          id: `existing-x-${pinName}`,
          endpoint: { kind: "terminal", instanceId: "existing-x", pinName },
        });
    }
    const baseline = createDesignNetlistExport(mapped.project, {
      format,
      includeLocations: true,
    });
    if (baseline.status !== "ready") throw new Error(JSON.stringify(baseline));
    const prefix = format === "spice" ? "X" : "";
    const originalName = `${prefix}M1${collision ? "_2" : ""}`;
    expect(baseline.file.text).toContain(`${originalName} `);
    if (format === "spice")
      expect(
        planNetlistCodeEdit(
          mapped.project,
          baseline,
          baseline.file.text.replace(`${originalName} `, "M_bad "),
        ).ok,
      ).toBe(false);
    const source = baseline.file.text
      .replace(`${originalName} `, `${printedName} `)
      .replace("w=1", "w=2");
    const plan = planNetlistCodeEdit(mapped.project, baseline, source);
    if (!plan.ok) throw new Error(plan.message);
    expect(
      netlistInstanceAtLine(source, source.indexOf(printedName), plan.instances)
        ?.instanceId,
    ).toBe(mos.id);
    const result = executeProjectTransaction(mapped.project, {
      transactionId: "rename",
      projectId: project.id,
      expectedStructureRevision: mapped.project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: plan.edits,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(
      result.project.documents
        .find((d) => d.id === leaf.id)!
        .instances.find((i) => i.id === mos.id)!.reference,
    ).toBe(authoredName);
    const next = createDesignNetlistExport(result.project, { format });
    if (next.status !== "ready") throw new Error(JSON.stringify(next));
    expect(next.file.text).toContain(
      `${authoredName.startsWith("X") ? "" : prefix}${authoredName} `,
    );
    expect(next.file.text).not.toContain("XXM_load");
  },
);

it.each<NetlistFormat>(["spice", "spectre"])(
  "round-trips reviewed geometry without changing units, expressions or authored keys (%s)",
  async (format) => {
    const { project } = await fixture(format);
    const { planSetDeviceModelTarget } = await import("@icm/edit-engine");
    const leaf = project.documents.find((d) => d.netlist?.name === "leaf")!;
    const mos = leaf.instances.find((i) => i.reference === "M1")!;
    const mapped = executeProjectTransaction(project, {
      transactionId: "geometry-map",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planSetDeviceModelTarget(
        project,
        leaf.id,
        mos.id,
        "sky130_fd_pr__nfet_01v8",
      ),
    });
    if (!mapped.ok) throw new Error(mapped.error.message);
    // A printer-normalized parameter name must still write the authored key.
    const owner = mapped.project.documents
      .find((d) => d.id === leaf.id)!
      .instances.find((i) => i.id === mos.id)!;
    owner.netlist!.parameters.W = owner.netlist!.parameters.w!;
    delete owner.netlist!.parameters.w;
    const baseline = createDesignNetlistExport(mapped.project, {
      format,
      includeLocations: true,
    });
    if (baseline.status !== "ready") throw new Error(JSON.stringify(baseline));
    const field = baseline.locations.fields.find(
      (f) => f.instanceId === mos.id && f.parameter === "w",
    )!;
    for (const [typed, stored, printed] of [
      ["2", "2u", "2"],
      ["250n", "250n", "0.25"],
      ["2 u", "2 u", "2"],
      ["250 n", "250 n", "0.25"],
      ["1e-3 m", "1e-3 m", "1"],
      ["{WIDTH}", "{(WIDTH) * 1u}", "{WIDTH}"],
    ]) {
      const draft =
        baseline.file.text.slice(0, field.startOffset) +
        typed +
        baseline.file.text.slice(field.endOffset);
      const plan = planNetlistCodeEdit(mapped.project, baseline, draft);
      if (!plan.ok) throw new Error(plan.message);
      const result = executeProjectTransaction(mapped.project, {
        transactionId: "geometry-edit",
        projectId: project.id,
        expectedStructureRevision: mapped.project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: plan.edits,
      });
      if (!result.ok) throw new Error(result.error.message);
      const updated = result.project.documents
        .find((d) => d.id === leaf.id)!
        .instances.find((i) => i.id === mos.id)!;
      expect(updated.netlist!.parameters.W).toBe(stored);
      expect(updated.netlist!.parameters).not.toHaveProperty("w");
      expect(updated.placement).toEqual(owner.placement);
      const next = createDesignNetlistExport(result.project, {
        format,
        includeLocations: true,
      });
      if (next.status !== "ready") throw new Error(JSON.stringify(next));
      expect(
        next.locations.fields.find(
          (f) => f.instanceId === mos.id && f.parameter === "w",
        )!.rawValue,
      ).toBe(printed);
      expect(
        planNetlistCodeEdit(result.project, next, next.file.text),
      ).toMatchObject({ ok: true, edits: [] });
    }
    for (const invalid of ["2 q", "2 u m"]) {
      const draft =
        baseline.file.text.slice(0, field.startOffset) +
        invalid +
        baseline.file.text.slice(field.endOffset);
      expect(planNetlistCodeEdit(mapped.project, baseline, draft).ok).toBe(
        false,
      );
    }
    for (const equivalent of ["1.0", "1u"]) {
      const same =
        baseline.file.text.slice(0, field.startOffset) +
        equivalent +
        baseline.file.text.slice(field.endOffset);
      expect(planNetlistCodeEdit(mapped.project, baseline, same)).toMatchObject(
        { ok: true, edits: [] },
      );
      const mixed = planNetlistCodeEdit(
        mapped.project,
        baseline,
        same.replace("10k", "20k"),
      );
      if (!mixed.ok) throw new Error(mixed.message);
      const applied = executeProjectTransaction(mapped.project, {
        transactionId: "mixed-equivalent",
        projectId: project.id,
        expectedStructureRevision: mapped.project.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: mixed.edits,
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) throw new Error(applied.error.message);
      expect(
        applied.project.documents
          .find((d) => d.id === leaf.id)!
          .instances.find((i) => i.id === mos.id)!.netlist!.parameters.W,
      ).toBe("1u");
    }
  },
);
