import { describe, expect, it } from "vitest";

import {
  formatDiagnostic,
  lintReport,
  touchedLinesByFile,
} from "./lint-report.mjs";

const at = (filename, line, severity, code = "typescript(rule)") => ({
  message: `${code} at ${line}`,
  code,
  severity,
  filename,
  labels: [{ span: { offset: 0, length: 1, line, column: 3 } }],
});

describe("lint report", () => {
  const diagnostics = [
    at("apps/editor/src/app/App.tsx", 10, "error"),
    at("apps/editor/src/app/App.tsx", 20, "warning"),
    at("apps/editor/src/app/App.tsx", 30, "warning"),
    at("packages/model/src/new-file.ts", 5, "warning"),
  ];

  it("shows every error, and the warnings on the lines a change touched", () => {
    const touched = {
      "apps/editor/src/app/App.tsx": new Set([30]),
      // A file new since the merge base is reported whole.
      "packages/model/src/new-file.ts": null,
    };
    const report = lintReport(diagnostics, (file) => touched[file]);
    expect(report.shown).toEqual([
      diagnostics[0],
      diagnostics[2],
      diagnostics[3],
    ]);
    expect(report).toMatchObject({ errors: 1, warnings: 2, quietWarnings: 1 });
  });

  it("shows everything, by file and line, for a run with no base", () => {
    // oxlint reports files in the order its threads finish them.
    expect(lintReport([...diagnostics].reverse())).toMatchObject({
      shown: diagnostics,
      errors: 1,
      warnings: 3,
      quietWarnings: 0,
    });
  });

  it("reads the touched lines of every file from one diff", () => {
    const diff = [
      "diff --git a/apps/editor/src/app/App.tsx b/apps/editor/src/app/App.tsx",
      "index 1111111..2222222 100644",
      "--- a/apps/editor/src/app/App.tsx",
      "+++ b/apps/editor/src/app/App.tsx",
      "@@ -10 +10 @@ function App() {",
      "-  old();",
      "+  void next();",
      "@@ -40,0 +41,2 @@",
      "+a",
      "+b",
      "diff --git a/scripts/lint.mjs b/scripts/lint.mjs",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/scripts/lint.mjs",
      "@@ -0,0 +1,3 @@",
      "+x",
      "diff --git a/worker/gone.ts b/worker/gone.ts",
      "deleted file mode 100644",
      "--- a/worker/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "",
    ].join("\n");
    expect(touchedLinesByFile(diff)).toEqual(
      new Map([
        ["apps/editor/src/app/App.tsx", new Set([10, 41, 42])],
        ["scripts/lint.mjs", null],
      ]),
    );
  });

  it("prints one line a diagnostic, with an error's help", () => {
    expect(
      formatDiagnostic({
        ...at(
          "worker/index.ts",
          4,
          "error",
          "typescript(no-floating-promises)",
        ),
        help: "Add void or handle the rejection.",
      }),
    ).toBe(
      "worker/index.ts:4:3  error  typescript(no-floating-promises)  typescript(no-floating-promises) at 4\n" +
        "    help: Add void or handle the rejection.",
    );
    expect(
      formatDiagnostic({
        ...at("worker/index.ts", 9, "warning"),
        help: "Not shown for a warning.",
      }),
    ).toBe(
      "worker/index.ts:9:3  warning  typescript(rule)  typescript(rule) at 9",
    );
  });
});
