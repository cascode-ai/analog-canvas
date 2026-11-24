import assert from "node:assert/strict";
import {
  createAgentCircuitService,
  buildAgentSessionSnapshot,
} from "@icm/agent-adapter";
import {
  collectProjectDiagnosticEvidence,
  evaluateSubmissionGates,
} from "@icm/derived";
import { parseProjectSnapshot } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { sha256 } from "./scaling-metrics.mjs";

const digest = (value) => sha256(JSON.stringify(value));
function timed(times, name, fn) {
  const start = performance.now();
  const result = fn();
  times[name] = Math.round((performance.now() - start) * 10) / 10;
  return result;
}
function snapshot(input) {
  const project = parseProjectSnapshot(parseProject(input));
  return {
    project,
    resolver: createProjectSymbolResolver(project, builtInSymbols),
  };
}
function target(input, id, times) {
  const { project, resolver } = snapshot(input);
  const document = project.documents.find((cell) => cell.id === id);
  const service = createAgentCircuitService({
    agentId: "diagnostic-benchmark",
    resolver,
    store: {
      getDocument: (key) =>
        project.documents.find((cell) => cell.id === (key ?? id)),
      getProject: () => project,
      commitDocument() {
        throw Error("Read-only benchmark");
      },
    },
    permissions: {
      snapshot: true,
      render: false,
      sourceSpans: false,
      edit: { connectivity: false, presentation: false, geometry: false },
    },
  });
  function read(detail, requestId) {
    return service.handle({
      operation: "snapshot",
      apiVersion: "3.0",
      documentId: id,
      projection: "state",
      diagnosticDetail: detail,
      requestId,
    });
  }
  const cold = timed(times, "coldCountsMs", () => read("counts", "cold"));
  assert.ok(cold.ok, JSON.stringify(cold.error));
  const warm = timed(times, "warmCountsMs", () => read("counts", "warm"));
  assert.deepEqual(warm.counts, cold.counts);
  const response = timed(times, "warmItemsMs", () => read("items", "items"));
  let diagnostics;
  if (response.ok) {
    diagnostics = response.diagnostics;
  } else {
    // A full host Snapshot exposes the ordered items before the service's
    // transport limit. Keep checking the public state refusal separately.
    assert.equal(response.error.code, "SNAPSHOT_TOO_LARGE");
    diagnostics = buildAgentSessionSnapshot({ project, document, resolver })
      .document.diagnostics;
  }
  assert.deepEqual(cold.counts, {
    errors: diagnostics.filter((item) => item.severity === "error").length,
    warnings: diagnostics.filter((item) => item.severity === "warning").length,
    total: diagnostics.length,
  });
  const json = JSON.stringify(diagnostics);
  const exports = {};
  for (const format of ["spice", "spectre"]) {
    const result = createDesignNetlistExport(project, {
      format,
      rootDocumentId: id,
    });
    exports[format] = digest(result);
  }
  return {
    id,
    count: diagnostics.length,
    ordered: sha256(json),
    diagnosticBytes: Buffer.byteLength(json),
    countsResponseBytes: Buffer.byteLength(JSON.stringify(cold)),
    itemsResponseBytes: Buffer.byteLength(JSON.stringify(response)),
    stateItems: response.ok ? "ok" : response.error.code,
    exports,
  };
}

export function measureDiagnosticCase(input) {
  const { project, resolver } = snapshot(input);
  const times = { cells: {} };
  const check = timed(times, "coldProjectMs", () =>
    collectProjectDiagnosticEvidence(project, resolver),
  );
  const projectItems = digest(check.diagnostics);
  const rawVisual = digest([...check.visualByDocument]);
  const warm = timed(times, "warmProjectMs", () =>
    collectProjectDiagnosticEvidence(project, resolver),
  );
  assert.equal(digest(warm.diagnostics), projectItems);
  assert.equal(digest([...warm.visualByDocument]), rawVisual);
  const gates = digest(evaluateSubmissionGates(project, resolver));
  const cells = [];
  for (const cell of project.documents) {
    const targetTimes = {};
    const signature = target(input, cell.id, targetTimes);
    times.cells[cell.id] = targetTimes;
    cells.push(signature);
  }
  const actual = {
    fullFile: sha256(serializeProject(project)),
    projectCount: check.diagnostics.length,
    projectItems,
    rawVisual,
    gates,
    cells,
  };
  return { actual, times };
}
