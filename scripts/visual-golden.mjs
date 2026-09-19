import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseProject } from "../packages/project-protocol/dist/index.js";
import { renderDocumentSvg } from "../packages/render-svg/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../packages/symbols/dist/index.js";

/**
 * Each entry pins one rendered Document against its committed golden.
 *
 * - `documentId` renders a child Cell instead of the Project's top Document,
 *   which is how the hierarchy pair proves both halves.
 * - `title` writes a literal SVG title; `titleFromProject` uses the Project's
 *   own name. With neither, the renderer falls back to the Document name.
 *
 * Every entry renders through `createProjectSymbolResolver`. A Cell instance
 * carries a `symbolId` generated from the child Cell name, which is absent
 * from `builtInSymbols`; a plain resolver therefore cannot draw hierarchy.
 */
const fixtures = [
  {
    input: "fixtures/projects/crossing-routes/project.icproj.json",
    output: "fixtures/visual-golden/crossing-routes.svg",
    title: "Crossing Routes",
  },
  {
    input: "fixtures/projects/differential-stage/project.icproj.json",
    output: "fixtures/visual-golden/differential-stage.svg",
    titleFromProject: true,
  },
  {
    input: "fixtures/projects/instance-value-display/project.icproj.json",
    output: "fixtures/visual-golden/instance-value-display.svg",
    titleFromProject: true,
  },
  {
    input: "fixtures/projects/hierarchical-gain-stage/project.icproj.json",
    output: "fixtures/visual-golden/hierarchical-gain-stage-top.svg",
    titleFromProject: true,
  },
  {
    input: "fixtures/projects/hierarchical-gain-stage/project.icproj.json",
    output: "fixtures/visual-golden/hierarchical-gain-stage-cell.svg",
    documentId: "document-gain-stage",
  },
];

for (const fixture of fixtures) {
  const input = resolve(process.cwd(), fixture.input);
  const output = resolve(process.cwd(), fixture.output);
  const project = parseProject(readFileSync(input, "utf8"));
  const documentId = fixture.documentId ?? project.topDocumentId;
  const document = project.documents.find(
    (candidate) => candidate.id === documentId,
  );
  if (!document) {
    throw new Error(`${fixture.input} has no Document ${documentId}`);
  }
  const title = fixture.titleFromProject ? project.name : fixture.title;
  const svg = renderDocumentSvg(
    document,
    createProjectSymbolResolver(project, builtInSymbols),
    ...(title === undefined ? [] : [{ title }]),
  );
  if (process.argv.includes("--check")) {
    if (readFileSync(output, "utf8") !== svg) {
      throw new Error(`Visual golden is stale: ${fixture.output}`);
    }
  } else {
    writeFileSync(output, svg, "utf8");
    console.log(`Wrote ${output}`);
  }
}
if (process.argv.includes("--check")) {
  console.log(`Validated ${fixtures.length} visual goldens`);
}
