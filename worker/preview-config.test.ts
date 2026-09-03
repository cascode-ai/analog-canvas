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
  assets?: { binding?: string; run_worker_first?: string[] | boolean };
  durable_objects?: {
    bindings: { name: string; class_name: string; script_name?: string }[];
  };
  migrations?: { tag: string; new_sqlite_classes?: string[] }[];
  containers?: { class_name: string; image: string; max_instances?: number }[];
  env?: Record<string, unknown>;
} {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  const stripped = source
    .replace(/^\s*\/\/.*$/gmu, "")
    .replace(/,(\s*[}\]])/gu, "$1");
  return JSON.parse(stripped) as ReturnType<typeof readConfig>;
}

describe("the preview channel configuration (ADR 0057)", () => {
  const preview = readConfig("wrangler.preview.jsonc");
  const production = readConfig("wrangler.jsonc");

  it("is its own Worker at its own single address", () => {
    expect(preview.name).toBe("interactive-circuit-maker-preview");
    expect(preview.routes).toEqual([
      { pattern: "analog-canvas-preview.tokenzhang.com", custom_domain: true },
    ]);
    // Two more hostnames would be two more unlisted doors to the same build.
    expect(preview.workers_dev).toBe(false);
    expect(preview.preview_urls).toBe(false);
    // And it must never name the production domain, inherited or written.
    expect(JSON.stringify(preview)).not.toContain(
      "analog-canvas.tokenzhang.com",
    );
    expect(preview.env).toBeUndefined();
  });

  it("declares its channel, and production declares none", () => {
    expect(preview.vars?.ICM_CHANNEL).toBe("preview");
    expect(production.vars?.ICM_CHANNEL).toBeUndefined();
  });

  it("reads the production gallery and owns everything else", () => {
    const bindings = new Map(
      preview.durable_objects!.bindings.map((binding) => [
        binding.name,
        binding,
      ]),
    );
    expect(bindings.get("GALLERY")).toEqual({
      name: "GALLERY",
      class_name: "GalleryDO",
      script_name: "interactive-circuit-maker",
    });
    for (const own of ["ANALYTICS", "AGENT_SESSION", "AUTH"]) {
      expect(bindings.get(own)?.script_name, own).toBeUndefined();
    }
  });

  it("binds the simulation container to a migrated class", () => {
    const binding = preview.durable_objects!.bindings.find(
      (candidate) => candidate.name === "NGSPICE",
    );
    expect(binding?.class_name).toBe("NgspiceContainer");
    expect(preview.containers?.[0]?.class_name).toBe("NgspiceContainer");
    expect(preview.containers?.[0]?.image).toBe(
      "./containers/ngspice/Dockerfile",
    );
    expect(preview.containers?.[0]?.max_instances).toBe(1);
    expect(
      preview.migrations?.some((migration) =>
        migration.new_sqlite_classes?.includes("NgspiceContainer"),
      ),
    ).toBe(true);
    // Production has no container yet: it arrives with a promoted release.
    expect(
      production.durable_objects?.bindings.some((b) => b.name === "NGSPICE"),
    ).toBe(false);
  });

  it("answers robots.txt itself so the preview is never listed", () => {
    expect(preview.assets?.binding).toBe("ASSETS");
    expect(preview.assets?.run_worker_first).toEqual(
      expect.arrayContaining(["/api/*", "/assets/*", "/robots.txt"]),
    );
  });
});
