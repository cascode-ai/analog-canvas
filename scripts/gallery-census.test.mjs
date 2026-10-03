import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  blockingFindings,
  compareReports,
  formatComparison,
  newestSnapshot,
  parseArguments,
  reusableReport,
  summarizeReport,
} from "./gallery-census.mjs";

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function report(entries) {
  return { commit: "abc1234", backup: "/snapshot/gallery.sqlite", entries };
}

describe("gallery census", () => {
  it("uses the newest downloaded snapshot that holds a database", () => {
    const directory = mkdtempSync(join(tmpdir(), "gallery-census-test-"));
    directories.push(directory);
    for (const name of [
      "gallery-2026-09-24T10-12-44Z-1-1",
      "gallery-2026-09-25T07-16-02Z-2-1",
      "gallery-2026-09-26T01-00-00Z-3-1",
    ])
      mkdirSync(join(directory, name));
    for (const name of [
      "gallery-2026-09-24T10-12-44Z-1-1",
      "gallery-2026-09-25T07-16-02Z-2-1",
    ])
      writeFileSync(join(directory, name, "gallery.sqlite"), "");
    // The newest capture is still downloading: it has no database yet.
    expect(newestSnapshot(directory)).toBe(
      join(directory, "gallery-2026-09-25T07-16-02Z-2-1", "gallery.sqlite"),
    );
    expect(newestSnapshot(join(directory, "absent"))).toBeNull();
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
    expect(parseArguments([]).checks).toEqual([]);
    expect(() => parseArguments(["--checks", "labels"])).toThrow("--checks");
  });

  it("reuses a full report of the same tree, snapshot and harness that ran the checks asked for", () => {
    const saved = {
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
      checks: ["netlist"],
    };
    expect(reusableReport([saved], wanted)).toBe(saved);
    for (const miss of [
      { tree: "tree-2" },
      { harness: "harness-2" },
      { backup: "/older/gallery.sqlite" },
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
    expect(
      reusableReport(
        [{ ...saved, checkGroups: ["netlist", "copy", "transform"] }],
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
      { id: "gone", name: "Gone", checks: { load: "ok" } },
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
      { id: "new", name: "New", checks: { load: "ok" } },
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
    expect(findings.missing).toEqual(["gone"]);
    expect(findings.added).toEqual(["new"]);
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
});
