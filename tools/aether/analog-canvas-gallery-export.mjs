#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createDesignNetlistExport, unfinishedDrawingDiagnostics, NETLIST_MARK_RULE_VERSION } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";

const [inputFile, outputDirectory, sourceCommit] = process.argv.slice(2);
if (!inputFile || !outputDirectory) {
  throw new Error("Usage: node EXPORT_BUNDLE.mjs PUBLIC_SNAPSHOT.json OUTPUT_DIRECTORY [SOURCE_COMMIT]");
}
const raw = fs.readFileSync(inputFile);
const snapshot = JSON.parse(raw.toString("utf8"));
if (snapshot.format !== "analog-canvas-public-gallery-snapshot-v1" || !snapshot.consistentCapture || !snapshot.offlineRestoreVerified) {
  throw new Error("Expected a verified public-only Gallery snapshot");
}
const output = path.resolve(outputDirectory);
if (fs.existsSync(output)) throw new Error("Output directory already exists; use a fresh export destination");
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(output, "circuits"), { mode: 0o700 });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
const results = [];
const seen = new Set();
for (const [index, entry] of snapshot.entries.entries()) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(entry.id) || seen.has(entry.id)) throw new Error("Invalid or duplicate Gallery ID");
  seen.add(entry.id);
  const dir = path.join(output, "circuits", entry.id);
  fs.mkdirSync(dir, { mode: 0o700 });
  fs.writeFileSync(path.join(dir, "project.icproj.json"), entry.project_text, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "preview.svg"), entry.svg_text, { mode: 0o600 });
  const row = {
    id: entry.id,
    name: entry.name,
    author: entry.author,
    description: entry.description,
    tags: entry.tags,
    createdAt: entry.created_at,
    url: `${snapshot.origin}/g/${entry.id}`,
    sourceSha256: sha256(entry.project_text),
    storedNetlistable: entry.netlistable === 1,
    storedMarkVersion: entry.netlistable_version,
    parsed: false,
    documentCount: 0,
    instanceCount: 0,
    formats: {},
  };
  let project;
  try {
    project = parseProject(entry.project_text);
    row.parsed = true;
    row.documentCount = project.documents.length;
    row.instanceCount = project.documents.reduce((sum, doc) => sum + doc.instances.length, 0);
  } catch (error) {
    row.parseError = { code: "PROJECT_UNREADABLE", message: error.message };
  }
  for (const [format, suffix] of [["spice", "sp"], ["spectre", "scs"]]) {
    if (!project) {
      row.formats[format] = { status: "unreadable", qualified: false, diagnostics: [row.parseError] };
      continue;
    }
    try {
      const exported = createDesignNetlistExport(project, { format });
      const unfinished = unfinishedDrawingDiagnostics(exported.diagnostics);
      const qualified = exported.status === "ready" && unfinished.length === 0;
      const detail = {
        status: exported.status,
        qualified,
        unfinishedDrawingCount: unfinished.length,
        diagnostics: exported.diagnostics,
      };
      if (exported.status === "ready") {
        const filename = `${qualified ? "netlist" : "draft"}.${suffix}`;
        fs.writeFileSync(path.join(dir, filename), exported.file.text, { mode: 0o600 });
        Object.assign(detail, { file: `circuits/${entry.id}/${filename}`, sha256: sha256(exported.file.text), cellCount: exported.cellCount, externalMasterCount: exported.externalMasterCount });
      }
      row.formats[format] = detail;
    } catch (error) {
      row.formats[format] = { status: "exception", qualified: false, diagnostics: [{ severity: "error", code: "EXPORT_EXCEPTION", message: error.message }] };
    }
  }
  writeJson(path.join(dir, "entry.json"), row);
  results.push(row);
  if ((index + 1) % 100 === 0 || index + 1 === snapshot.entries.length) console.log(`Exported ${index + 1}/${snapshot.entries.length}`);
}
const formatSummary = (format) => {
  const count = (predicate) => results.filter((row) => predicate(row.formats[format])).length;
  const codes = new Map();
  for (const row of results) {
    const item = row.formats[format];
    if (item.qualified) continue;
    for (const code of new Set(item.diagnostics.filter((d) => d.severity === "error" || item.status === "unreadable").map((d) => d.code))) {
      codes.set(code, (codes.get(code) ?? 0) + 1);
    }
  }
  return {
    ready: count((item) => item.status === "ready"),
    qualified: count((item) => item.qualified),
    unfinishedDrafts: count((item) => item.status === "ready" && !item.qualified),
    blocked: count((item) => item.status === "blocked"),
    unreadable: count((item) => item.status === "unreadable"),
    exceptions: count((item) => item.status === "exception"),
    blockingCodesByCircuit: Object.fromEntries([...codes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
  };
};
const summary = {
  format: "analog-canvas-gallery-export-v1",
  origin: snapshot.origin,
  generatedAt: new Date().toISOString(),
  captureStartedAt: snapshot.captureStartedAt,
  captureEndedAt: snapshot.captureEndedAt,
  sourceSnapshot: snapshot.sourceSnapshot,
  ...(sourceCommit ? { sourceCommit } : {}),
  netlistMarkRuleVersion: NETLIST_MARK_RULE_VERSION,
  inputSha256: sha256(raw),
  scope: snapshot.scope,
  allGalleryStatusCounts: snapshot.statusCounts,
  publicEntries: results.length,
  parsedProjects: results.filter((row) => row.parsed).length,
  totalDocuments: results.reduce((sum, row) => sum + row.documentCount, 0),
  totalInstances: results.reduce((sum, row) => sum + row.instanceCount, 0),
  storedNetlistable: results.filter((row) => row.storedNetlistable).length,
  storedMarkDisagreements: results.filter((row) => row.storedNetlistable !== row.formats.spice.qualified).map((row) => row.id),
  spice: formatSummary("spice"),
  spectre: formatSummary("spectre"),
  bothQualified: results.filter((row) => row.formats.spice.qualified && row.formats.spectre.qualified).length,
  simulationPerformed: false,
};
writeJson(path.join(output, "summary.json"), summary);
writeJson(path.join(output, "manifest.json"), { ...summary, entries: results });
writeJson(path.join(output, "blocked.json"), results.filter((row) => !row.formats.spice.qualified).map((row) => ({ id: row.id, name: row.name, url: row.url, status: row.formats.spice.status, diagnostics: row.formats.spice.diagnostics })));
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const lines = [["id", "name", "author", "spiceQualified", "spectreQualified", "spiceStatus", "spectreStatus", "documents", "instances", "url"].map(csv).join(",")];
for (const row of results) lines.push([row.id, row.name, row.author, row.formats.spice.qualified, row.formats.spectre.qualified, row.formats.spice.status, row.formats.spectre.status, row.documentCount, row.instanceCount, row.url].map(csv).join(","));
fs.writeFileSync(path.join(output, "inventory.csv"), lines.join("\n") + "\n", { mode: 0o600 });
fs.writeFileSync(path.join(output, "README.md"), [
  "# Analog Canvas Gallery Export",
  "",
  `Captured: ${summary.captureEndedAt}`,
  ...(sourceCommit ? [`Export source commit: ${sourceCommit}`] : []),
  `Scope: ${snapshot.scope}`,
  "",
  `Public Gallery entries: ${summary.publicEntries}`,
  `SPICE qualified netlists: ${summary.spice.qualified}`,
  `Spectre qualified netlists: ${summary.spectre.qualified}`,
  `SPICE unfinished drafts: ${summary.spice.unfinishedDrafts}`,
  `SPICE blocked/unreadable/exception: ${summary.spice.blocked}/${summary.spice.unreadable}/${summary.spice.exceptions}`,
  "",
  "Each circuits/<id>/ directory preserves the original Project Code and stored preview, public metadata, exact exporter diagnostics and available netlists.",
  "netlist.sp/netlist.scs require both strict extraction and the official finished-drawing gate. draft.sp/draft.scs are printable but contain unfinished-drawing findings; they are excluded from qualified counts.",
  "Source drawings are never repaired, snapped, renamed or remapped during export. No PDK translation or simulation was performed. Export success does not establish simulation success or Aether/HES import support.",
  "Stored previews are snapshot artifacts, not newly rendered images. Gallery entries may contain multiple Cells; totals count entries rather than Cells.",
  "summary.json contains counts; inventory.csv lists every public entry; manifest.json includes all diagnostics; blocked.json lists entries without qualified SPICE output.",
  "",
].join("\n"), { mode: 0o600 });
console.log(JSON.stringify(summary, null, 2));
