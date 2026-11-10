import { createHash } from "node:crypto";
import type { CircuitProject, ObjectLocator } from "@icm/model";
import { importSpiceSources } from "@icm/spice";
import { expect, it } from "vitest";
import { importLocalCircuit } from "../../agent/import-local-circuit";
import { reviewFeedbackText } from "./review-feedback";

function locatorOf(project: CircuitProject, cell: string, reference: string) {
  const document = project.documents.find(({ name }) => name === cell)!;
  const instance = document.instances.find(
    (item) => item.reference === reference,
  )!;
  const locator: ObjectLocator = {
    documentId: document.id,
    hierarchyPath: [],
    kind: "instance",
    objectId: instance.id,
    ...(instance.sourceRef ? { sourceRef: instance.sourceRef } : {}),
  };
  return locator;
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
  const locator = locatorOf(project, "amp", "R1");
  await expect(
    reviewFeedbackText(project, locator, "R1", "  Use 2k here.\n"),
  ).resolves.toBe(
    [
      "Canvas review feedback",
      "Cell: amp",
      `Object: R1 (instance ${locator.objectId})`,
      "Source: amp.sp:3",
      "",
      "Use 2k here.",
    ].join("\n"),
  );
  // A Net has no single line.
  const { sourceRef: _line, ...net } = { ...locator, kind: "net" as const };
  await expect(
    reviewFeedbackText(project, net, "A", "Check A."),
  ).resolves.not.toContain("Source:");
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
  await expect(
    reviewFeedbackText(project, locatorOf(project, "amp", "R1"), "R1", "Hi"),
  ).resolves.toContain("Source: amp.scs:5");
});
