import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { deriveStableId, type CircuitProject } from "@icm/model";
import { localSourceIdentity } from "@icm/agent-adapter";
import { embeddedReviewSource } from "./embedded-review-source";

function sourceRecord(path: string, text: string) {
  const sha256 = createHash("sha256").update(text).digest("hex");
  return {
    id: deriveStableId("source", path),
    path,
    hash: `sha256:${sha256}`,
    content: { text, encoding: "utf-8" as const },
  };
}

it("verifies the original dependency closure without absorbing copied source records", async () => {
  const entry = sourceRecord(
    "cells/main.scs",
    [
      '// @RNL { @USE-PACKAGE(name="lib",version="0.1",path="../layout.rnl"); }',
      "simulator lang=spectre",
      'include "/pdk/models.scs" section=tt',
      'include "design.scs"',
      "",
    ].join("\n"),
  );
  const drawing = sourceRecord("layout.rnl", '@RNL { @VERSION("0.3"); }\n');
  const design = sourceRecord("cells/design.scs", "// Circuit source\n");
  const foreign = sourceRecord(
    "foreign/copied.scs",
    "// Copied into a new Cell\n",
  );
  const source: CircuitProject["source"] = {
    entry: entry.path,
    dialect: "spice3f5-core",
    sourcePolicy: "copy",
    files: [entry, drawing, design, foreign],
  };
  const expected = [entry, drawing, design].map(({ path, hash }) => ({
    path,
    sha256: hash.slice(7),
  }));
  const version = createHash("sha256")
    .update(
      localSourceIdentity(
        entry.path,
        expected.map(({ path, sha256 }) => ({ name: path, sha256 })),
      ),
    )
    .digest("hex");
  expect(await embeddedReviewSource(source)).toEqual({
    entryPath: entry.path,
    version,
    files: expected,
  });
  const changed = {
    ...drawing,
    content: { ...drawing.content, text: "different bytes" },
  };
  expect(
    await embeddedReviewSource({ ...source, files: [entry, changed, design] }),
  ).toBeUndefined();
});
