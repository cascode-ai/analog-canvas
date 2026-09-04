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
  containers?: {
    class_name: string;
    image: string;
    max_instances?: number;
    image_build_context?: string;
    instance_type?: string;
  }[];
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
    // The production domain appears once, as the origin gallery reads are
    // fetched from; never as a route this Worker would answer for.
    expect(preview.vars?.ICM_GALLERY_UPSTREAM).toBe(
      "https://analog-canvas.tokenzhang.com",
    );
    expect(JSON.stringify(preview.routes)).not.toContain(
      "analog-canvas.tokenzhang.com",
    );
    // No environments inside this file: nothing to inherit, nothing to forget.
    expect(preview.env).toBeUndefined();
  });

  it("declares its channel, and production declares none", () => {
    expect(preview.vars?.ICM_CHANNEL).toBe("preview");
    expect(production.vars?.ICM_CHANNEL).toBeUndefined();
    expect(production.vars?.ICM_GALLERY_UPSTREAM).toBeUndefined();
  });

  it("binds no Durable Object of the production script", () => {
    // A binding has no read-only mode, and this Worker runs code production
    // has not accepted yet. Gallery reads go over HTTP to the public API
    // instead; accounts, sessions, gallery store, and analytics are the
    // preview's own, and every bound class has its migration.
    const bindings = preview.durable_objects!.bindings;
    for (const binding of bindings) {
      expect(binding.script_name, binding.name).toBeUndefined();
    }
    const migrated = new Set(
      preview.migrations?.flatMap((m) => m.new_sqlite_classes ?? []),
    );
    for (const binding of bindings) {
      expect(migrated.has(binding.class_name), binding.class_name).toBe(true);
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
    // Preview builds both substrates behind one Worker contract. The host is
    // the current default, but the binding remains available for explicit
    // parity checks; configuring one must not erase the other.
    expect(preview.vars?.SIMULATION_UPSTREAM_URL).toBe(
      "https://sim-fra.analog-canvas.tokenzhang.com",
    );
    expect(preview.vars?.SIMULATION_DEFAULT_EXECUTOR).toBe("operator-host");
    // Production has no container yet: it arrives with a promoted release.
    expect(
      production.durable_objects?.bindings.some((b) => b.name === "NGSPICE"),
    ).toBe(false);
  });

  it("builds the container from the repository root, and the Dockerfile agrees", () => {
    // The model files are staged at pdk/ in the repository root, so the build
    // context is the root and every COPY in the Dockerfile must be written
    // relative to it. The first preview deploy failed on a COPY that was
    // relative to the Dockerfile's own directory instead.
    expect(preview.containers?.[0]?.image_build_context).toBe(".");
    const dockerfile = readFileSync(
      resolve(process.cwd(), "containers/ngspice/Dockerfile"),
      "utf8",
    );
    for (const line of dockerfile.split("\n")) {
      if (!line.startsWith("COPY ") || line.includes("--from=")) continue;
      const source = line.split(/\s+/u)[1] ?? "";
      expect(
        source.startsWith("pdk/") ||
          source.startsWith("containers/") ||
          source.startsWith("${SKY130_ROOT}") ||
          source.startsWith("${HARNESS_DIR}"),
        line,
      ).toBe(true);
    }
  });

  it("builds the simulator on the benchmark image, pinned by digest", () => {
    // Simulator and models byte-identical to what analog-arena runs, so an
    // acceptance disagreement can only mean our export is wrong (#551); and
    // the continuous library has no device-width ceiling.
    const dockerfile = readFileSync(
      resolve(process.cwd(), "containers/ngspice/Dockerfile"),
      "utf8",
    );
    expect(dockerfile).toMatch(
      /^ARG BASE_IMAGE=ghcr\.io\/arcadia-1\/circuit-bench-sky130-ngspice@sha256:[0-9a-f]{64}$/mu,
    );
    expect(dockerfile).toMatch(/^FROM \$\{BASE_IMAGE\}$/mu);
    // No second simulator installed over the pinned one.
    expect(dockerfile).not.toMatch(/apt-get install[^\n]*\bngspice\b/u);
  });

  it("runs the Worker on every path so noindex and robots reach the shell", () => {
    // The stamp and the robots answer live in the Worker; a path the asset
    // layer answers alone never carries them. The first live verification
    // found /editor without noindex for exactly that reason.
    expect(preview.assets?.binding).toBe("ASSETS");
    expect(preview.assets?.run_worker_first).toBe(true);
    // Production keeps its narrow list: it has nothing to stamp.
    expect(Array.isArray(production.assets?.run_worker_first)).toBe(true);
  });

  it("gives the simulator a core that can parse the model corner", () => {
    // Measured: about 16 s of CPU to load the Sky130 tt corner. A quarter
    // core timed out a resistor divider at 60 s on the first live run.
    expect(preview.containers?.[0]?.instance_type).toBe("standard-2");
  });
});
