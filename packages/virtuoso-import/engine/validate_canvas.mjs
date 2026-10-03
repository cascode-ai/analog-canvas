import fs from "node:fs";
import { segmentIntersectsRect } from "./segment_geometry.mjs";
import { CircuitProjectSchema } from "../../model/dist/index.js";
import {
  tryParseProjectWithMetadata,
  serializeProject,
} from "../../project-protocol/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../../symbols/dist/index.js";
import { renderDocumentSvg } from "../../render-svg/dist/index.js";
import {
  diagnoseVisualQuality,
  resolveEndpointPoint,
  resolveRouteGeometry,
  resolveDocumentLogicalNets,
  buildProjectConnectivityIndex,
  runErcChecks,
} from "../../derived/dist/index.js";

const file = process.argv[2];
const allowLabelOverlap = process.argv
  .slice(3)
  .includes("--allow-label-overlap");
const allowSymbolOverlap = process.argv
  .slice(3)
  .includes("--allow-symbol-overlap");
const parsed = tryParseProjectWithMetadata(fs.readFileSync(file, "utf8"));
if (!parsed.ok) {
  console.error(JSON.stringify(parsed.diagnostics, null, 2));
  process.exit(1);
}
const project = parsed.project;
const resolver = createProjectSymbolResolver(project, builtInSymbols);
const doc = project.documents[0];
const endpoints = doc.routes.flatMap((r) => [
  r.start,
  r.legs.at(-1).to.endpoint,
]);
for (const endpoint of endpoints) {
  if (!resolveEndpointPoint(doc, resolver, endpoint))
    throw Error("Unresolved endpoint " + JSON.stringify(endpoint));
}
const diagnostics = {
  schemaValid: true,
  endpointsResolved: endpoints.length,
  visual: diagnoseVisualQuality(doc, resolver),
  erc: runErcChecks(
    project,
    buildProjectConnectivityIndex(project, resolver),
    resolver,
  ),
};
// Only tolerate open box pins proven to be open in the source snapshot.
const sourceOpenIndex = process.argv.indexOf("--source-unconnected-box-pins");
const sourceOpen =
  sourceOpenIndex < 0
    ? []
    : JSON.parse(fs.readFileSync(process.argv[sourceOpenIndex + 1], "utf8"));
diagnostics.sourceUnconnectedBoxPins = diagnostics.erc.filter(
  (d) =>
    d.code === "ERC_UNCONNECTED_PIN" &&
    !d.parameters?.netId &&
    sourceOpen.some(
      (p) =>
        p.instanceId === d.parameters?.instanceId &&
        p.pinName === d.parameters?.pinName,
    ),
);
const boundaryIndex = process.argv.indexOf("--source-omitted-port-interfaces");
const boundary =
  boundaryIndex < 0
    ? []
    : JSON.parse(fs.readFileSync(process.argv[boundaryIndex + 1], "utf8"));
diagnostics.omittedPortBoundaryWarnings = diagnostics.erc.filter(
  (d) =>
    ["ERC_UNCONNECTED_PIN", "ERC_FLOATING_GATE"].includes(d.code) &&
    boundary.some(
      (t) => t.targetNetId && t.targetNetId === d.parameters?.netId,
    ) &&
    doc.nets.some(
      (n) =>
        n.id === d.parameters?.netId &&
        n.terminals.length === 1 &&
        n.terminals[0].instanceId === d.parameters?.instanceId &&
        n.terminals[0].pinName === d.parameters?.pinName,
    ),
);
diagnostics.blockingErc = diagnostics.erc.filter(
  (d) =>
    d.severity === "error" &&
    !diagnostics.sourceUnconnectedBoxPins.includes(d) &&
    !diagnostics.omittedPortBoundaryWarnings.includes(d),
);
diagnostics.diagonalSegments = 0;
for (const route of doc.routes) {
  const geometry = resolveRouteGeometry(doc, resolver, route);
  if (!geometry) throw Error("Unresolved geometry: " + route.id);
  for (const segment of geometry.segments) {
    if (segment.from.x !== segment.to.x && segment.from.y !== segment.to.y)
      diagnostics.diagonalSegments++;
  }
}
const logical = resolveDocumentLogicalNets(doc);
if (logical.groups.some((n) => n.baseNetIds.length !== 1 || n.conflicts.length))
  throw Error(
    "Target naming merged distinct source nets or introduced a conflict",
  );
diagnostics.logicalNets = logical.groups.length;
diagnostics.allowedLabelOverlap = allowLabelOverlap;
diagnostics.allowedSymbolOverlap = allowSymbolOverlap;
diagnostics.diagonalBoundsFalsePositives = [];
for (const d of diagnostics.visual) {
  if (
    d.code !== "VISUAL_WIRE_THROUGH_SYMBOL" ||
    d.gateEligible !== false ||
    !d.bounds
  )
    continue;
  const route = doc.routes.find((r) => r.id === d.objectIds[0]);
  const segment =
    route &&
    resolveRouteGeometry(doc, resolver, route)?.segments[
      d.parameters?.segmentIndex
    ];
  if (
    segment &&
    segment.from.x !== segment.to.x &&
    segment.from.y !== segment.to.y &&
    !segmentIntersectsRect(segment.from, segment.to, d.bounds)
  )
    diagnostics.diagonalBoundsFalsePositives.push(d);
}
const falsePositiveIds = new Set(
  diagnostics.diagonalBoundsFalsePositives.map((d) => d.id),
);
diagnostics.blockingVisual = diagnostics.visual.filter(
  (d) => d.severity === "error",
);
diagnostics.visualWarnings = diagnostics.visual.filter(
  (d) => d.severity !== "error" && !falsePositiveIds.has(d.id),
);
const roundtrip = tryParseProjectWithMetadata(serializeProject(project));
if (!roundtrip.ok) throw Error("Roundtrip failed");
CircuitProjectSchema.parse(roundtrip.project);
fs.writeFileSync(
  file.replace(".icproj.json", ".validation.json"),
  JSON.stringify(diagnostics, null, 2),
);
console.log(
  JSON.stringify({
    schemaValid: true,
    endpoints: endpoints.length,
    visual: diagnostics.visualWarnings.map((x) => x.code),
    erc: diagnostics.erc.map((x) => x.code),
  }),
);
if (diagnostics.blockingVisual.length || diagnostics.blockingErc.length) {
  console.error("Review diagnostics before delivering this circuit.");
  process.exitCode = 1;
} else {
  fs.writeFileSync(
    file.replace(".icproj.json", ".svg"),
    renderDocumentSvg(doc, resolver, { title: project.name }),
  );
}
