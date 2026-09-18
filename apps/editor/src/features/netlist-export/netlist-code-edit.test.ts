import { describe, it, expect } from "vitest";
import { importSpiceSources } from "@icm/spice";
import { createDesignNetlistExport, type NetlistFormat } from "@icm/netlist";
import { executeProjectTransaction } from "@icm/edit-engine";
import {
  planNetlistCodeEdit,
  netlistInstanceAtLine,
} from "./netlist-code-edit";

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

describe.each<NetlistFormat>(["spice", "spectre"])(
  "%s netlist editing",
  (format) => {
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
