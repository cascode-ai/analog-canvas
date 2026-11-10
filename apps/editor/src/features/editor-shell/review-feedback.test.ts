import type { ObjectLocator } from "@icm/model";
import { importSpiceSources } from "@icm/spice";
import { expect, it } from "vitest";
import { reviewFeedbackText } from "./review-feedback";

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
  const cell = project.documents.find(({ name }) => name === "amp")!;
  const resistor = cell.instances.find(({ reference }) => reference === "R1")!;
  const locator: ObjectLocator = {
    documentId: cell.id,
    hierarchyPath: [],
    kind: "instance",
    objectId: resistor.id,
    ...(resistor.sourceRef ? { sourceRef: resistor.sourceRef } : {}),
  };
  expect(reviewFeedbackText(project, locator, "R1", "  Use 2k here.\n")).toBe(
    [
      "Canvas review feedback",
      "Cell: amp",
      `Object: R1 (instance ${resistor.id})`,
      "Source: amp.sp:3",
      "",
      "Use 2k here.",
    ].join("\n"),
  );
  // A Net has no single line.
  const { sourceRef: _line, ...net } = { ...locator, kind: "net" as const };
  expect(reviewFeedbackText(project, net, "A", "Check A.")).not.toContain(
    "Source:",
  );
});
