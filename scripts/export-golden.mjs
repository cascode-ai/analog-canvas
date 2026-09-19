import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createFormalExportSource } from "../packages/exporters/dist/index.js";
import { exportFormalArtifacts } from "../packages/exporters/dist/node.js";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import {
  InMemorySymbolResolver,
  builtInSymbols,
} from "../packages/symbols/dist/index.js";

const check = process.argv.includes("--check");
const fixtureRoot = resolve("fixtures/exports/differential-stage");
const project = parseProject(
  await readFile(
    resolve("fixtures/projects/differential-stage/project.icproj.json"),
    "utf8",
  ),
);
const document = project.documents.find(
  (candidate) => candidate.id === project.topDocumentId,
);
if (!document) throw new Error("Dense analog top Document is missing");
const source = createFormalExportSource(
  document,
  new InMemorySymbolResolver(builtInSymbols),
  { title: project.name },
);
const artifacts = await exportFormalArtifacts(source, 3);
const outputs = {
  "schematic.svg": artifacts.svg,
  "schematic.png": artifacts.png.bytes,
  "schematic.pdf": artifacts.pdf,
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = Buffer.from(
  `${JSON.stringify(
    {
      version: "0.1.0",
      sourceProject: "fixtures/projects/differential-stage/project.icproj.json",
      bounds: source.bounds,
      raster: {
        scale: 3,
        width: artifacts.png.width,
        height: artifacts.png.height,
      },
      files: Object.fromEntries(
        Object.entries(outputs).map(([name, bytes]) => [
          name,
          { byteLength: bytes.byteLength, sha256: sha256(bytes) },
        ]),
      ),
    },
    null,
    2,
  )}\n`,
);
outputs["manifest.json"] = manifest;

if (check) {
  for (const [name, bytes] of Object.entries(outputs)) {
    const expected = await readFile(resolve(fixtureRoot, name));
    if (!expected.equals(Buffer.from(bytes)))
      throw new Error(`Export golden differs: ${name}`);
  }
  process.stdout.write("Export goldens match.\n");
} else {
  await mkdir(fixtureRoot, { recursive: true });
  for (const [name, bytes] of Object.entries(outputs))
    await writeFile(resolve(fixtureRoot, name), bytes);
  process.stdout.write(`${fixtureRoot}\n`);
}
