import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { AnalyticsDO as EntrypointAnalyticsDO } from "../../../worker/index";
import { ANALYTICS_PERSISTENCE_IDENTITY, AnalyticsDO } from "./worker";

type WranglerConfig = {
  name: string;
  durable_objects: {
    bindings: { name: string; class_name: string }[];
  };
  migrations: {
    tag: string;
    new_sqlite_classes?: string[];
  }[];
};

function readWranglerConfig(file: string): WranglerConfig {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  const stripped = source
    .replace(/^\s*\/\/.*$/gmu, "")
    .replace(/,(\s*[}\]])/gu, "$1");
  return JSON.parse(stripped) as WranglerConfig;
}

describe("analytics persistence identity", () => {
  it("keeps the production namespace that owns the existing counts", () => {
    const config = readWranglerConfig("wrangler.jsonc");
    expect(config.name).toBe("interactive-circuit-maker");
    expect(config.durable_objects.bindings).toContainEqual({
      name: "ANALYTICS",
      class_name: "AnalyticsDO",
    });
    expect(config.migrations).toContainEqual({
      tag: "v1",
      new_sqlite_classes: ["AnalyticsDO"],
    });
  });

  it("keeps Preview isolated under the same analytics contract", () => {
    const config = readWranglerConfig("wrangler.preview.jsonc");
    expect(config.name).toBe("interactive-circuit-maker-preview");
    expect(config.durable_objects.bindings).toContainEqual({
      name: "ANALYTICS",
      class_name: "AnalyticsDO",
    });
    expect(config.migrations).toContainEqual({
      tag: "v1",
      new_sqlite_classes: ["AnalyticsDO"],
    });
  });

  it("locks the object, cookies, routes, and Worker entrypoint export", () => {
    expect(ANALYTICS_PERSISTENCE_IDENTITY).toEqual({
      binding: "ANALYTICS",
      durableObjectClass: "AnalyticsDO",
      objectName: "global",
      visitorCookie: "canvas_vid",
      sessionCookie: "canvas_sid",
      routes: ["/api/track", "/api/stats", "/api/analytics"],
    });
    expect(EntrypointAnalyticsDO).toBe(AnalyticsDO);
  });
});
