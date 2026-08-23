import { describe, expect, it } from "vitest";

import {
  assessTestImpact,
  readTestImpactTrailers,
  testPathKind,
} from "./test-impact.mjs";

const updated = ["feat: something\n\nTest-Impact: tests-updated"];
const noChange = [
  "style: reflow a comment\n\nTest-Impact: no-test-change — comment only",
];

describe("test-impact governance", () => {
  it("classifies co-located, browser, and script paths", () => {
    expect(testPathKind("packages/model/src/schema.ts")).toBe("implementation");
    expect(testPathKind("apps/editor/e2e/project-file.spec.ts")).toBe("test");
    expect(testPathKind("packages/model/src/schema.test.ts")).toBe("test");
    expect(testPathKind("scripts/check-test-impact.mjs")).toBe(
      "implementation",
    );
    expect(testPathKind("docs/specs/edit-engine.md")).toBe("other");
  });

  it("reads the decision from a commit trailer", () => {
    expect(readTestImpactTrailers(updated)).toEqual([
      { valid: true, decision: "tests-updated" },
    ]);
    expect(readTestImpactTrailers(noChange)).toEqual([
      { valid: true, decision: "no-test-change" },
    ]);
    expect(readTestImpactTrailers(["chore: nothing declared"])).toEqual([]);
  });

  it("rejects a bare no-test-change, which asserts without evidence", () => {
    expect(
      readTestImpactTrailers(["fix: x\n\nTest-Impact: no-test-change"]),
    ).toEqual([
      {
        valid: false,
        reason: "no-test-change requires evidence on the same line",
      },
    ]);
  });

  it("ignores changes that touch no implementation path", () => {
    expect(
      assessTestImpact(["docs/user/getting-started.md"], []),
    ).toMatchObject({ ok: true });
  });

  it("requires a declaration when production code changes", () => {
    const paths = ["packages/model/src/schema.ts"];
    expect(assessTestImpact(paths, [])).toMatchObject({ ok: false });
    expect(
      assessTestImpact(paths, readTestImpactTrailers(noChange)),
    ).toMatchObject({ ok: true });
  });

  it("cross-checks the declaration against the diff", () => {
    const withTests = [
      "packages/model/src/schema.ts",
      "packages/model/src/schema.test.ts",
    ];
    // Claiming tests-updated is only true when a test actually changed, and
    // claiming no-test-change is only honest when none did.
    expect(
      assessTestImpact(withTests, readTestImpactTrailers(updated)),
    ).toMatchObject({ ok: true });
    expect(
      assessTestImpact(withTests, readTestImpactTrailers(noChange)),
    ).toMatchObject({ ok: false });
    expect(
      assessTestImpact(
        ["packages/model/src/schema.ts"],
        readTestImpactTrailers(updated),
      ),
    ).toMatchObject({ ok: false });
  });

  it("accepts a declaration from any commit in the range", () => {
    const messages = ["chore: follow-up", ...updated];
    expect(
      assessTestImpact(
        ["packages/model/src/schema.ts", "packages/model/src/schema.test.ts"],
        readTestImpactTrailers(messages),
      ),
    ).toMatchObject({ ok: true });
  });
});
