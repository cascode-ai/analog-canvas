import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseProject } from "@icm/project-protocol";
import { buildAgentSessionSnapshot } from "@icm/agent-adapter";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { searchSnapshot, compactActionReport } from "./results.js";
import type { CachedSnapshot } from "@icm/agent-client";

it("summarizes repeated successful diagnostics without dropping errors or mutating full detail", () => {
  const diagnostics = Array.from({ length: 30 }, (_, i) => ({
    code: "UNCONNECTED",
    severity: "warning" as const,
    message: `pin ${i} is unconnected`,
  }));
  const all = [
    ...diagnostics,
    { code: "BAD_BINDING", severity: "error" as const, message: "bad model" },
  ];
  const report = {
    ok: true,
    stage: "done" as const,
    documentId: "doc",
    diagnostics: all,
    diagnosticDelta: { added: all, removed: [] },
  };
  const compact = compactActionReport(report);
  expect(compact.diagnostics).toHaveLength(2);
  expect(compact.diagnostics?.some((d) => d.code === "BAD_BINDING")).toBe(true);
  expect(compact).toMatchObject({
    diagnosticSummary: { total: 31, omitted: 29 },
    diagnosticDelta: { addedCount: 31, removedCount: 0 },
  });
  expect(report.diagnosticDelta.added).toHaveLength(31);
  expect(
    compactActionReport({ ...report, ok: false }).diagnostics,
  ).toHaveLength(31);
});

it("searches resolved bound labels rather than absent literal content", () => {
  const project = parseProject(
    readFileSync(
      "fixtures/projects/differential-stage/project.icproj.json",
      "utf8",
    ),
  );
  const document = project.documents[0]!;
  document.annotations.push({
    id: "bound-ref",
    kind: "instance-label",
    binding: {
      kind: "instance-reference",
      instanceId: document.instances[0]!.id,
    },
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.annotations.push({
    id: "bound-net",
    kind: "net-label",
    netId: "net-vinp",
    binding: { kind: "net-name", netId: "net-vinp" },
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.annotations.push({
    id: "bound-value",
    kind: "instance-value",
    binding: { kind: "instance-value", instanceId: "M1", parameter: "w" },
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  const snapshot = buildAgentSessionSnapshot({
    project,
    document,
    resolver: new InMemorySymbolResolver(builtInSymbols),
  });
  const entry = {
    snapshot,
    diagnostics: [],
    revision: document.revision,
  } as unknown as CachedSnapshot;
  const bound = snapshot.document.annotations.filter(
    (a) => a.binding && a.resolvedText,
  );
  expect(bound.map((a) => a.id)).toEqual(
    expect.arrayContaining(["bound-ref", "bound-net", "bound-value"]),
  );
  for (const annotation of bound) {
    expect(
      searchSnapshot(entry, annotation.resolvedText!, ["annotation"], 100).map(
        (hit) => hit.id,
      ),
    ).toContain(annotation.id);
  }
});
