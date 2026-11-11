import { createHash } from "node:crypto";
import type { CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { importSpiceSources } from "@icm/spice";
import { expect, it } from "vitest";
import { importLocalCircuit } from "../../agent/import-local-circuit";
import {
  reviewFeedbackLabel,
  reviewFeedbackTarget,
  reviewFeedbackText,
} from "./review-feedback";

function importedCell(project: CircuitProject, name: string) {
  return project.documents.find((document) => document.name === name)!;
}

it("names the Cell, the object and its netlist line, then the comment", async () => {
  const path = "amp.sp";
  const loaded = await importSpiceSources(
    [
      {
        path,
        bytes: new TextEncoder().encode(
          "* amp\n.subckt amp A B\nR1 A B 1k\n.ends amp\n",
        ),
      },
    ],
    path,
  );
  const project = loaded.project!;
  const cell = importedCell(project, "amp");
  const resistor = cell.instances.find(({ reference }) => reference === "R1")!;
  const net = cell.nets[0]!;
  const target = reviewFeedbackTarget({
    project,
    cell,
    hierarchyPath: [],
    sourceVersion: "amp-v1",
    instanceIds: [resistor.id],
    netIds: [net.id, net.id],
    netName: () => "A",
  });
  await expect(
    reviewFeedbackText([
      { target, comment: "  Use 2k and check this Net.\n" },
      { target: { ...target, objects: [] }, comment: "Check the entire Cell." },
    ]),
  ).resolves.toBe(
    [
      "Canvas review feedback",
      "",
      "Note 1",
      "Source version: amp-v1",
      `Project: ${project.id} (structure revision ${project.structureRevision})`,
      `Cell: amp (${cell.id})`,
      `Cell revision: ${cell.revision}`,
      `Object: R1 (instance ${resistor.id})`,
      "Source: amp.sp:3",
      `Object: A (net ${net.id})`,
      "",
      "Use 2k and check this Net.",
      "",
      "Note 2",
      "Source version: amp-v1",
      `Project: ${project.id} (structure revision ${project.structureRevision})`,
      `Cell: amp (${cell.id})`,
      `Cell revision: ${cell.revision}`,
      "",
      "Check the entire Cell.",
    ].join("\n"),
  );
});

it("names the line of a Spectre file as delivered, not as converted", async () => {
  const text = [
    "// Virtuoso export",
    "simulator lang=spectre",
    "",
    "subckt amp (A B)",
    "    R1 (A B) resistor r=1k",
    "ends amp",
    "",
  ].join("\n");
  const bytes = new TextEncoder().encode(text);
  const { project } = await importLocalCircuit(
    [
      {
        path: "amp.scs",
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
    "amp.scs",
  );
  const cell = importedCell(project, "amp");
  const target = reviewFeedbackTarget({
    project,
    cell,
    hierarchyPath: [],
    sourceVersion: "spectre-v1",
    instanceIds: [
      cell.instances.find(({ reference }) => reference === "R1")!.id,
    ],
    netIds: [],
    netName: () => undefined,
  });
  await expect(
    reviewFeedbackText([{ target, comment: "Check this resistor." }]),
  ).resolves.toContain("Source: amp.scs:5");
});

it("shows the printed netlist names for selected unnamed Nets and copies their IDs", async () => {
  const path = "chain.sp";
  const loaded = await importSpiceSources(
    [
      {
        path,
        bytes: new TextEncoder().encode(
          ".subckt chain A B\nR1 A middle1 1k\nR2 middle1 middle2 2k\nR3 middle2 B 3k\n.ends chain\n",
        ),
      },
    ],
    path,
  );
  const project = loaded.project!;
  const cell = importedCell(project, "chain");
  const first = cell.instances.find(({ reference }) => reference === "R1")!;
  const last = cell.instances.find(({ reference }) => reference === "R3")!;
  const firstNet = cell.nets.find(({ terminals }) =>
    terminals.some(
      ({ instanceId, pinName }) => instanceId === first.id && pinName === "2",
    ),
  )!;
  const lastNet = cell.nets.find(({ terminals }) =>
    terminals.some(
      ({ instanceId, pinName }) => instanceId === last.id && pinName === "1",
    ),
  )!;
  const netIds = [firstNet.id, lastNet.id];
  cell.connectivityEvidence = cell.connectivityEvidence.filter(
    ({ netId }) => !netIds.includes(netId),
  );
  const exported = createDesignNetlistExport(project, {
    rootDocumentId: cell.id,
  });
  if (exported.status !== "ready") throw new Error("Expected a ready netlist");
  const firstName = /^R1 A (net\d+) 1k$/mu.exec(exported.file.text)?.[1];
  const lastName = /^R3 (net\d+) B 3k$/mu.exec(exported.file.text)?.[1];
  expect(firstName).toBeDefined();
  expect(lastName).toBeDefined();
  expect(firstName).not.toBe(lastName);

  const target = reviewFeedbackTarget({
    project,
    cell,
    hierarchyPath: [],
    sourceVersion: "chain-v1",
    instanceIds: [],
    netIds,
    netName: () => undefined,
  });
  const label = reviewFeedbackLabel(target);
  expect(label).toContain(`Net ${firstName}`);
  expect(label).toContain(`Net ${lastName}`);
  const feedback = await reviewFeedbackText([
    { target, comment: "Review the middle Nets." },
  ]);
  expect(feedback).toContain(`Object: ${firstName} (net ${firstNet.id})`);
  expect(feedback).toContain(`Object: ${lastName} (net ${lastNet.id})`);
});
