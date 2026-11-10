import { importSpiceSources } from "@icm/spice";
import { expect, it } from "vitest";
import { compareReviewSource } from "./review-source-comparison";

it("compares the source model's declared polarity with the Canvas device", async () => {
  const entryPath = "model.sp";
  const source = (model: "nmos" | "pmos") => ({
    entryPath,
    version: model,
    files: [
      {
        path: entryPath,
        bytes: new TextEncoder().encode(
          `* source\n.model nch ${model}\n.subckt dut A B\nM1 A B 0 0 nch w=1u l=1u\n.ends dut\n`,
        ),
      },
    ],
  });
  const loaded = await importSpiceSources(source("nmos").files, entryPath);
  expect(loaded.successful).toBe(true);
  const project = loaded.project!;
  const compare = (model: "nmos" | "pmos") =>
    compareReviewSource(project, project.topDocumentId, source(model));
  await expect(compare("nmos")).resolves.toMatchObject({
    status: "equal",
    differences: [],
  });
  await expect(compare("pmos")).resolves.toMatchObject({
    status: "different",
    differences: [
      {
        kind: "declaration",
        object: "model nch",
        actual: "nmos",
        expected: "pmos",
        source: { path: entryPath, line: 2 },
      },
    ],
  });
});
