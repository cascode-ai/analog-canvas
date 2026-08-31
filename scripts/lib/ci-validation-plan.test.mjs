import { readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  formatCiValidationPlan,
  planCiValidation,
} from "./ci-validation-plan.mjs";
import { loadGateCatalog, planValidation } from "./validation-gates.mjs";

const catalog = await loadGateCatalog();

function ciPlan(paths, options) {
  return planCiValidation(planValidation(paths, catalog), options);
}

describe("CI validation planning", () => {
  it("skips implementation jobs for documentation-only work", () => {
    expect(ciPlan(["docs/user/getting-started.md"])).toMatchObject({
      heavy: false,
      mode: "documentation",
      e2eArgs: [],
    });
  });

  it("selects the Gallery browser contract without unrelated editor specs", () => {
    expect(ciPlan(["worker/gallery.ts"])).toMatchObject({
      heavy: true,
      mode: "focused",
      e2eArgs: ["apps/editor/e2e/gallery.spec.ts"],
    });
  });

  it("combines fixed browser contracts for a bounded cross-feature change", () => {
    expect(
      ciPlan([
        "worker/gallery.ts",
        "apps/editor/src/features/component-insert/symbol-catalog.ts",
      ]),
    ).toMatchObject({
      mode: "focused",
      e2eArgs: [
        "apps/editor/e2e/component-insert.spec.ts",
        "apps/editor/e2e/gallery.spec.ts",
      ],
    });
  });

  it("keeps shared model changes on the complete browser suite", () => {
    expect(ciPlan(["packages/model/src/schema/document.ts"])).toMatchObject({
      heavy: true,
      mode: "full",
      e2eArgs: [],
    });
  });

  it("falls back to complete browser coverage for an unmapped code path", () => {
    const plan = ciPlan(["apps/editor/src/lib/new-helper.ts"]);
    expect(plan.mode).toBe("full");
    expect(plan.reasons[0]).toContain("no focused browser contract");
  });

  it("does not hide an unmapped path behind another focused selection", () => {
    const plan = ciPlan([
      "worker/gallery.ts",
      "apps/editor/src/lib/new-helper.ts",
    ]);
    expect(plan.mode).toBe("full");
    expect(plan.reasons).toContain(
      "uncovered browser impact: apps/editor/src/lib/new-helper.ts",
    );
  });

  it("keeps every browser spec reachable through a focused route", async () => {
    const directory = new URL("../../apps/editor/e2e/", import.meta.url);
    const specs = (await readdir(directory))
      .filter((name) => name.endsWith(".spec.ts"))
      .map((name) => `apps/editor/e2e/${name}`)
      .sort();

    for (const spec of specs) {
      const plan = ciPlan([spec]);
      expect(plan.mode, spec).toBe("focused");
      expect(plan.e2eArgs, spec).toContain(spec);
    }
  });

  it("treats validation-policy documentation as a full fallback", () => {
    expect(ciPlan(["docs/testing/README.md"])).toMatchObject({
      heavy: true,
      mode: "full",
      e2eArgs: [],
    });
  });

  it("forces complete validation for scheduled and merge-queue events", () => {
    expect(
      ciPlan(["docs/user/getting-started.md"], { forceFull: true }),
    ).toMatchObject({ heavy: true, mode: "full", e2eArgs: [] });
  });

  it("renders the browser choice for job logs", () => {
    expect(formatCiValidationPlan(ciPlan(["worker/auth.ts"]))).toContain(
      "Browser selection: apps/editor/e2e/gallery.spec.ts",
    );
  });
});
