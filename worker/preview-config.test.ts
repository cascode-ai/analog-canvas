import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** wrangler.jsonc allows comments and trailing commas; JSON does not. */
function readConfig(file: string): {
  name?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  routes?: { pattern: string; custom_domain?: boolean }[];
  vars?: Record<string, string>;
  assets?: unknown;
  triggers?: unknown;
  durable_objects?: {
    bindings: { name: string; class_name: string; script_name?: string }[];
  };
  r2_buckets?: { binding: string; bucket_name: string }[];
  queues?: unknown;
  migrations: {
    tag: string;
    new_sqlite_classes?: string[];
    deleted_classes?: string[];
  }[];
  env?: Record<string, unknown>;
} {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  const stripped = source
    .replace(/^\s*\/\/.*$/gmu, "")
    .replace(/,(\s*[}\]])/gu, "$1");
  return JSON.parse(stripped) as ReturnType<typeof readConfig>;
}

describe("the retired Preview storage authority", () => {
  const preview = readConfig("wrangler.preview.jsonc");
  const production = readConfig("wrangler.jsonc");

  it("has no public or background execution entrance", () => {
    expect(preview.name).toBe("interactive-circuit-maker-preview");
    expect(preview.routes).toEqual([]);
    expect(preview.workers_dev).toBe(false);
    expect(preview.preview_urls).toBe(false);
    expect(preview.assets).toBeUndefined();
    expect(preview.triggers).toBeUndefined();
    expect(preview.queues).toBeUndefined();
    expect(preview.env).toBeUndefined();
  });

  it("keeps the isolated Durable Object and R2 declarations recoverable", () => {
    const bindings = preview.durable_objects!.bindings;
    expect(bindings.map((binding) => binding.name).sort()).toEqual(
      [
        "AGENT_SESSION",
        "ANALYTICS",
        "AUTH",
        "COMPONENT_LIBRARY",
        "GALLERY",
        "SIMULATION_CONTROL",
      ].sort(),
    );
    expect(bindings.every((binding) => binding.script_name === undefined)).toBe(
      true,
    );
    const migrated = new Set(
      preview.migrations.flatMap(
        (migration) => migration.new_sqlite_classes ?? [],
      ),
    );
    for (const binding of bindings) {
      expect(migrated.has(binding.class_name), binding.class_name).toBe(true);
    }
    expect(preview.r2_buckets).toEqual([
      {
        binding: "SIMULATION_ARTIFACTS",
        bucket_name: "analog-canvas-simulation-artifacts-preview",
      },
    ]);
  });

  it("does not weaken the active Production configuration", () => {
    expect(production.routes).toEqual([
      { pattern: "analog-canvas.tokenzhang.com", custom_domain: true },
    ]);
    expect(production.assets).toBeDefined();
    expect(production.queues).toBeDefined();
    expect(production.durable_objects?.bindings.length).toBeGreaterThan(0);
  });

  it("keeps simulator credential rotation away from the dormant Worker", () => {
    const deploy = readFileSync(
      resolve(process.cwd(), "containers/vacask/host/deploy-preview.sh"),
      "utf8",
    );
    expect(deploy).toContain(
      "workers/scripts/interactive-circuit-maker/secrets",
    );
    expect(deploy).not.toContain(
      "workers/scripts/interactive-circuit-maker-preview/secrets",
    );
  });
});
