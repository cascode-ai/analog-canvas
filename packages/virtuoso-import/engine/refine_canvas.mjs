// Use upstream endpoint and route primitives to resolve the active MOS variant.
import fs from "node:fs";
import assert from "node:assert/strict";
import { separateLabels } from "./label_layout.mjs";
import { placeNativeInstanceLabels } from "./native_labels.mjs";
import { refineBoxRoutes } from "./box_routes.mjs";
import { trimBulkRoutes } from "./bulk_routes.mjs";
import { placePortLabels } from "./port_labels.mjs";
import { alignEndMarkers } from "./align_end_markers.mjs";
import { applySdbTemplates } from "./sdb_templates.mjs";
import { createRoutePath, routeEnd } from "../../model/dist/index.js";
import {
  tryParseProjectWithMetadata,
  validateProject,
  serializeProject,
} from "../../project-protocol/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../../symbols/dist/index.js";
import {
  resolveEndpointConnection,
  resolveRouteGeometry,
  diagnoseVisualQuality,
} from "../../derived/dist/index.js";
import { buildOrthogonalEscapeRoute } from "../../edit-engine/dist/route-geometry-edit.js";
import {
  normalizeRedundantDirectContactRoutes,
  normalizeSameNetConductorTopology,
} from "../../edit-engine/dist/index.js";

const file = process.argv[2];
const parsed = tryParseProjectWithMetadata(fs.readFileSync(file, "utf8"));
if (!parsed.ok) {
  fs.writeFileSync(
    file.replace(".icproj.json", ".validation.json"),
    JSON.stringify(
      {
        schemaValid: false,
        format: parsed.diagnostics,
        blockingErc: [],
        blockingVisual: [],
      },
      null,
      2,
    ),
  );
  console.error("Generated project does not match the Analog Canvas schema.");
  process.exit(1);
}
const project = parsed.project;
const resolver = createProjectSymbolResolver(project, builtInSymbols);
const doc = project.documents[0];
const originalNets = structuredClone(doc.nets);
const timings = {};
function timed(name, fn) {
  const start = performance.now();
  console.error(`[refine:start] ${name}`);
  const result = fn();
  timings[name] = Math.round(performance.now() - start);
  console.error(`[refine:done] ${name} ${timings[name]}ms`);
  return result;
}
const changes = [];
const boxRoutes = timed("boxRoutes", () =>
  refineBoxRoutes(doc, resolver, { stubLength: Number(process.argv[3] ?? 40) }),
);
for (const route of [...doc.routes]) {
  if (route.presentation !== "bulk-dashed") continue;
  const original = resolveRouteGeometry(doc, resolver, route);
  if (!original) throw Error("Missing route geometry");
  if (original.segments.some((s) => s.from.x !== s.to.x && s.from.y !== s.to.y))
    continue;
  const start = resolveEndpointConnection(doc, resolver, route.start);
  const end = resolveEndpointConnection(doc, resolver, routeEnd(route));
  if (!start || !end) throw Error("Missing route endpoint");
  const geometry = buildOrthogonalEscapeRoute(
    start,
    end,
    30,
    doc.presentation.grid,
  );
  const replacement = {
    ...createRoutePath({
      id: route.id,
      netId: route.netId,
      start: route.start,
      end: routeEnd(route),
      bends: geometry.waypoints,
      modes: geometry.segmentModes,
    }),
    presentation: "bulk-dashed",
  };
  doc.routes[doc.routes.findIndex((r) => r.id === route.id)] = replacement;
  changes.push(route.id);
}
// Match the editor's import normalization before delivering the project.
doc.revision++;
const bulkJoins = timed("bulkJoins", () => trimBulkRoutes(doc, resolver));
const directContacts = timed("directContacts", () =>
  normalizeRedundantDirectContactRoutes(doc, resolver),
);
const topology = timed("topology", () =>
  normalizeSameNetConductorTopology(doc, resolver),
);
const sdbTemplates = timed("sdbTemplates", () =>
  applySdbTemplates(doc, resolver),
);
const endMarkers = timed("endMarkers", () => alignEndMarkers(doc, resolver));
const nativeLabelChanges = timed("nativeLabels", () =>
  placeNativeInstanceLabels(doc, resolver),
);
const portLabelChanges = timed("portLabels", () =>
  placePortLabels(doc, resolver),
);
const labelChanges = timed("labelSeparation", () =>
  separateLabels(
    doc,
    resolver,
    new Set([...nativeLabelChanges, ...portLabelChanges].map((c) => c.id)),
  ),
);
assert.deepEqual(
  doc.nets,
  originalNets,
  "Route refinement changed electrical membership",
);
doc.revision++;
fs.writeFileSync(file, serializeProject(validateProject(project)));
const remainingVisual = timed("visualDiagnostics", () =>
  diagnoseVisualQuality(doc, resolver),
);
fs.writeFileSync(
  file.replace(".icproj.json", ".refinement.json"),
  JSON.stringify(
    {
      changes,
      boxRoutes,
      bulkJoins,
      timings,
      endMarkers,
      directContacts,
      topology,
      sdbTemplates,
      nativeLabelChanges,
      portLabelChanges,
      labelChanges,
      electricalMembershipVerified: true,
      remainingVisual,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ refinedBulkRoutes: changes.length }));
