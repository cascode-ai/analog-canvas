import { importSpiceSources } from "@icm/spice";
import { expect, it } from "vitest";
import { compareReviewSource } from "./review-source-comparison";

it("compares the source model's declared polarity with the Canvas device", async () => {
  const entryPath = "model.sp";
  const source = (model: "nmos" | "pmos" | "missing") => ({
    entryPath,
    version: model,
    files: [
      {
        path: entryPath,
        bytes: new TextEncoder().encode(
          `* source\n${model === "missing" ? "" : `.model nch ${model}\n`}.subckt dut A B\nM1 A B 0 0 nch w=1u l=1u\n.ends dut\n`,
        ),
      },
    ],
  });
  const original = source("nmos");
  const loaded = await importSpiceSources(original.files, entryPath);
  expect(loaded.successful).toBe(true);
  const project = loaded.project!;
  const compare = (model: "nmos" | "pmos" | "missing") =>
    compareReviewSource(
      project,
      project.topDocumentId,
      source(model),
      original,
    );
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
  await expect(compare("missing")).resolves.toMatchObject({
    status: "inconclusive",
    summary: "Structural comparison is incomplete",
    reasons: [expect.stringContaining("no longer declares the used model nch")],
  });
});
