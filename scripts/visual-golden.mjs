import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseProject } from "../packages/project-protocol/dist/index.js";
import { renderDocumentSvg } from "../packages/render-svg/dist/index.js";
import { createRoutePath } from "../packages/model/dist/index.js";
import {
  InMemorySymbolResolver,
  builtInSymbols,
} from "../packages/symbols/dist/index.js";

const fixtures = [
  {
    input: "fixtures/projects/crossing-routing/project.icproj.json",
    output: "fixtures/visual-golden/crossing-routing.svg",
    title: "Phase 3 Crossing",
    crossingRoutes: true,
  },
  {
    input: "fixtures/projects/differential-stage/project.icproj.json",
    output: "fixtures/visual-golden/differential-stage.svg",
    title: "project",
  },
];
const resolver = new InMemorySymbolResolver(builtInSymbols);
for (const fixture of fixtures) {
  const input = resolve(process.cwd(), fixture.input);
  const output = resolve(process.cwd(), fixture.output);
  const project = parseProject(readFileSync(input, "utf8"));
  const document = project.documents.find(
    (candidate) => candidate.id === project.topDocumentId,
  );
  if (!document) throw new Error(`${fixture.input} has no top Document`);
  if (fixture.crossingRoutes) {
    const terminal = (instanceId) => ({
      kind: "terminal",
      instanceId,
      pinName: "P",
    });
    document.routes = [
      createRoutePath({
        id: "route-h",
        netId: "net-h",
        start: terminal("A"),
        end: terminal("B"),
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "route-v",
        netId: "net-v",
        start: terminal("C"),
        end: terminal("D"),
        bends: [],
        modes: ["manual"],
      }),
    ];
  }
  const svg = renderDocumentSvg(document, resolver, {
    ...(fixture.title
      ? { title: fixture.title === "project" ? project.name : fixture.title }
      : {}),
  });
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
  console.log(`Validated ${fixtures.length} Phase 1/3/5 visual goldens`);
}
