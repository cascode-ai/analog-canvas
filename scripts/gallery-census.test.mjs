import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  blockingFindings,
  compareReports,
  formatComparison,
  parseArguments,
  reusableReport,
  summarizeReport,
} from "./gallery-census.mjs";

function report(entries) {
  return {
    format: "analog-canvas/gallery-census",
    version: 2,
    commit: "abc1234",
    tree: "tree-1",
    harness: "harness-1",
    backup: "/snapshot/gallery.sqlite",
    snapshotHash: "snapshot-1",
    complete: true,
    statuses: ["public"],
    checkGroups: ["copy"],
    target: "fresh-project-grid10-offset0-v1",
    entries: entries.map((entry) => ({
      ...entry,
      checks: {
        load: "ok",
        markers: "ok",
        copyToProject: "ok",
        copyLooksAlike: "ok",
        copyKeepsConnections: "ok",
        copyInPlace: "ok",
        copyOfCopies: "ok",
        ...entry.checks,
      },
    })),
  };
}

describe("gallery census", () => {
  it("refuses a CI invocation before opening any private snapshot", () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./gallery-census.mjs", import.meta.url)),
        "--backup",
        "does-not-exist.sqlite",
      ],
      { encoding: "utf8", env: { ...process.env, CI: "true" } },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("local only");
  });

  it("returns distinct CLI statuses for unchanged, regressed and incomparable reports", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "gallery-census-compare-test-"),
    );
    try {
      const base = report([{ id: "a", name: "A", checks: {} }]);
      const basePath = join(directory, "base.json");
      const headPath = join(directory, "head.json");
      writeFileSync(basePath, JSON.stringify(base));
      const run = (head) => {
        writeFileSync(headPath, JSON.stringify(head));
        return spawnSync(
          process.execPath,
          [
            fileURLToPath(new URL("./gallery-census.mjs", import.meta.url)),
            "--compare",
            basePath,
            headPath,
          ],
          { encoding: "utf8", env: { ...process.env, CI: "" } },
        );
      };
      const unchanged = run(base);
      expect(unchanged.status).toBe(0);
      expect(unchanged.stdout).toContain("No drawing behaves differently");
      const regressed = run(
        report([
          { id: "a", name: "A", checks: { copyToProject: "Copy failed" } },
        ]),
      );
      expect(regressed.status).toBe(1);
      expect(regressed.stdout).toContain("a copyToProject: ok → Copy failed");
      const incomparable = run({ ...base, snapshotHash: "other-snapshot" });
      expect(incomparable.status).toBe(2);
      expect(incomparable.stderr).toContain("rerun both refs");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("refuses reports that cannot prove the same complete measurement", () => {
    const base = report([{ id: "a", name: "A", checks: {} }]);
    for (const change of [
      { version: 1 },
      { version: 999 },
      { format: "different" },
      { complete: false },
      { snapshotHash: "different-snapshot" },
      { harness: "different-harness" },
      { checkGroups: ["insert"] },
      { target: "different-target" },
      { statuses: ["all"] },
    ]) {
      expect(() => compareReports(base, { ...base, ...change })).toThrow(
        /not comparable/iu,
      );
    }
  });

  it("refuses missing, added, duplicate entries and unmeasured checks", () => {
    const base = report([{ id: "a", name: "A", checks: {} }]);
    const entry = base.entries[0];
    for (const entries of [
      [],
      [entry, { ...entry, id: "new" }],
      [entry, entry],
      [{ ...entry, checks: { load: "ok" } }],
    ])
      expect(() => compareReports(base, { ...base, entries })).toThrow(
        /not comparable/iu,
      );
  });

  it("compares insertion success separately from its placement or fallback route", () => {
    const base = {
      ...report([
        {
          id: "a",
          name: "A",
          checks: { open: "ok", insert: "ok" },
          insertOutcome: "inserted",
        },
      ]),
      checkGroups: ["insert"],
    };
    const entry = base.entries[0];
    const fallback = {
      ...base,
      entries: [{ ...entry, insertOutcome: "new-tab" }],
    };
    expect(blockingFindings(compareReports(base, fallback))).toBe(0);
    for (const insertOutcome of [undefined, "invented", "failed"])
      expect(() =>
        compareReports(base, {
          ...base,
          entries: [{ ...entry, insertOutcome }],
        }),
      ).toThrow(/not comparable/iu);
    const failed = {
      ...base,
      entries: [
        {
          ...entry,
          checks: { ...entry.checks, insert: "Placement commit failed" },
          insertOutcome: "failed",
        },
      ],
    };
    expect(compareReports(base, failed).newlyFailing).toMatchObject([
      { id: "a", check: "insert" },
    ]);
    expect(blockingFindings(compareReports(failed, failed))).toBe(0);
  });

  it("reads its options and refuses what it does not know", () => {
    expect(
      parseArguments([
        "--",
        "--base",
        "origin/main",
        "--only",
        "a,b",
        "--limit",
        "5",
      ]),
    ).toMatchObject({ base: "origin/main", only: ["a", "b"], limit: 5 });
    expect(parseArguments(["--compare", "a.json", "b.json"]).compare).toEqual([
      "a.json",
      "b.json",
    ]);
    expect(() => parseArguments(["--base", "a", "--ref", "b"])).toThrow(
      "do not combine",
    );
    expect(() => parseArguments(["--status", "draft"])).toThrow("--status");
    expect(() => parseArguments(["--backup"])).toThrow("needs a value");
    expect(() => parseArguments(["--everything"])).toThrow("Unknown option");
    expect(parseArguments(["--checks", "netlist,copy"]).checks).toEqual([
      "netlist",
      "copy",
    ]);
    expect(parseArguments(["--checks", "insert"]).checks).toEqual(["insert"]);
    expect(parseArguments([]).checks).toEqual([]);
    expect(() => parseArguments(["--checks", "labels"])).toThrow("--checks");
  });

  it("reuses only a complete report with the same content, tree, harness and checks", () => {
    const saved = {
      ...report([]),
      tree: "tree-1",
      harness: "harness-1",
      backup: "/snapshot/gallery.sqlite",
      statuses: ["public"],
      complete: true,
      checkGroups: ["netlist", "copy"],
      path: "plan/gallery-census-abc.json",
    };
    const wanted = {
      tree: "tree-1",
      harness: "harness-1",
      backup: "/snapshot/gallery.sqlite",
      status: "public",
      snapshotHash: "snapshot-1",
      checks: ["netlist", "copy"],
    };
    expect(reusableReport([saved], wanted)).toBe(saved);
    for (const miss of [
      { tree: "tree-2" },
      { harness: "harness-2" },
      { snapshotHash: "changed-content-at-the-same-path" },
      { status: "all" },
      // A report without the transform group cannot stand in for it.
      { checks: ["netlist", "transform"] },
      // Every group, when none is named.
      { checks: [] },
      // A dirty checkout or harness has no identity to match.
      { tree: null },
      { harness: null },
    ])
      expect(reusableReport([saved], { ...wanted, ...miss })).toBeNull();
    expect(reusableReport([{ ...saved, complete: false }], wanted)).toBeNull();
    expect(reusableReport([{ ...saved, version: 1 }], wanted)).toBeNull();
    expect(
      reusableReport([saved], { ...wanted, backup: "/moved/gallery.sqlite" }),
    ).toBe(saved);
    expect(
      reusableReport([saved], { ...wanted, checks: ["netlist"] }),
    ).toBeNull();
    expect(
      reusableReport(
        [{ ...saved, checkGroups: ["netlist", "copy", "transform", "insert"] }],
        { ...wanted, checks: [] },
      ),
    ).toMatchObject({ tree: "tree-1" });
  });

  it("blocks on drawings that newly fail, changed netlists and labels that stopped following", () => {
    const base = report([
      {
        id: "same",
        name: "Same",
        checks: { load: "ok", copyInPlace: "ok" },
        netlistHash: "1",
        labelsFollowing: ["label-a"],
      },
      {
        id: "worse",
        name: "Worse",
        checks: { load: "ok", copyInPlace: "ok" },
        netlistHash: "1",
        labelsFollowing: ["label-a", "label-b"],
      },
      {
        id: "better",
        name: "Better",
        checks: { load: "ok", copyInPlace: "Route r1 is empty" },
      },
    ]);
    const head = report([
      {
        id: "same",
        name: "Same",
        checks: { load: "ok", copyInPlace: "ok" },
        netlistHash: "1",
        labelsFollowing: ["label-a"],
      },
      {
        id: "worse",
        name: "Worse",
        checks: { load: "ok", copyInPlace: "Route r1_2 is empty" },
        netlistHash: "2",
        labelsFollowing: ["label-a"],
      },
      {
        id: "better",
        name: "Better",
        checks: { load: "ok", copyInPlace: "ok" },
      },
    ]);
    const findings = compareReports(base, head);
    expect(findings.newlyFailing).toEqual([
      {
        id: "worse",
        name: "Worse",
        check: "copyInPlace",
        before: "ok",
        after: "Route r1_2 is empty",
      },
    ]);
    expect(findings.newlyPassing.map((item) => item.id)).toEqual(["better"]);
    expect(findings.netlistChanged).toEqual([{ id: "worse", name: "Worse" }]);
    expect(findings.labelsStoppedFollowing).toEqual([
      { id: "worse", name: "Worse", labels: ["label-b"] },
    ]);
    expect(findings.missing).toEqual([]);
    expect(findings.added).toEqual([]);
    expect(blockingFindings(findings)).toBe(3);
    expect(formatComparison(findings)).toContain(
      "worse copyInPlace: ok → Route r1_2 is empty",
    );
  });

  it("does not block on a failure that only reads differently", () => {
    const findings = compareReports(
      report([
        { id: "a", name: "A", checks: { copyInPlace: "Route r1 is empty" } },
      ]),
      report([
        { id: "a", name: "A", checks: { copyInPlace: "Route r1_2 is empty" } },
      ]),
    );
    expect(findings.changed).toHaveLength(1);
    expect(blockingFindings(findings)).toBe(0);
    expect(formatComparison(compareReports(report([]), report([])))).toBe(
      "No drawing behaves differently.",
    );
  });

  it("blocks on a netlist mark that changed while the mark rule version did not (#1284)", () => {
    const marked = (version, mark) => ({
      ...report([
        { id: "a", name: "A", checks: { netlist: "ok" }, netlistMark: mark },
        { id: "b", name: "B", checks: { netlist: "ok" }, netlistMark: true },
      ]),
      netlistMarkRuleVersion: version,
    });
    const stale = compareReports(marked(11, false), marked(11, true));
    expect(stale.marksChanged).toEqual([
      { id: "a", name: "A", before: false, after: true },
    ]);
    expect(blockingFindings(stale)).toBe(1);
    expect(formatComparison(stale)).toContain(
      "Netlist marks changed without a NETLIST_MARK_RULE_VERSION bump",
    );
    // With the version moved, the Gallery asks every stored mark again.
    const bumped = compareReports(marked(11, false), marked(12, true));
    expect(blockingFindings(bumped)).toBe(0);
    expect(formatComparison(bumped)).toContain("the rule version moved");
    // Reports from before marks were recorded compare as before.
    expect(blockingFindings(compareReports(report([]), report([])))).toBe(0);
  });

  it("summarizes each check with its most common failures", () => {
    const summary = summarizeReport(
      report([
        { id: "a", name: "A", checks: { netlist: "ok" } },
        { id: "b", name: "B", checks: { netlist: "blocked: MISSING_PIN_NET" } },
        { id: "c", name: "C", checks: { netlist: "blocked: MISSING_PIN_NET" } },
      ]),
    );
    expect(summary).toContain("Gallery census of 3 drawings at abc1234");
    expect(summary).toContain("netlist        1 ok, 2 not");
    expect(summary).toContain("2 × blocked: MISSING_PIN_NET");
  });

  it("names the drawings whose real open or insertion failed", () => {
    const summary = summarizeReport(
      report([
        {
          id: "open-broken",
          name: "Open broken",
          checks: { open: "Parse failed", insert: "Capture failed" },
          insertOutcome: "failed",
        },
        {
          id: "commit-broken",
          name: "Commit broken",
          checks: { open: "ok", insert: "Placement commit failed" },
          insertOutcome: "failed",
        },
        {
          id: "fallback",
          name: "Fallback",
          checks: { open: "ok", insert: "ok" },
          insertOutcome: "new-tab",
        },
      ]),
    );
    expect(summary).toContain("open-broken (Open broken) open: Parse failed");
    expect(summary).toContain(
      "open-broken (Open broken) insert: Capture failed",
    );
    expect(summary).toContain(
      "commit-broken (Commit broken) insert: Placement commit failed",
    );
    expect(summary).not.toContain("fallback (Fallback)");
  });
});
