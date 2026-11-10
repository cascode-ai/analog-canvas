import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  calendarOf,
  classify,
  generate,
  parseJsonc,
  renderConfig,
} from "./regional-runtime.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = async (path) =>
  parseJsonc(await readFile(join(root, path), "utf8"));

describe("regional runtime declaration", () => {
  it("can exclude the overseas verification store without creating a local copy", async () => {
    const wrangler = await read("wrangler.jsonc");
    const region = await read("containers/canvas-cn/formal/region.jsonc");
    wrangler.r2_buckets.push({
      binding: "OVERSEAS_PROOF",
      bucket_name: "proof",
    });
    region.excluded["r2_buckets.OVERSEAS_PROOF"] =
      "CI proof is read only from the fixed overseas origin.";
    expect(classify(wrangler, region)).toEqual([]);
    expect(renderConfig(wrangler, region)).not.toContain(
      'name = "OVERSEAS_PROOF"',
    );
  });
  it("keeps the committed China configuration generated from wrangler.jsonc", async () => {
    for (const [path, text] of Object.entries(await generate()))
      expect(await readFile(join(root, path), "utf8"), path).toBe(text);
  });

  it("refuses Production configuration the region neither carries nor excludes", async () => {
    const wrangler = await read("wrangler.jsonc");
    const region = await read("containers/canvas-cn/formal/region.jsonc");
    expect(classify(wrangler, region)).toEqual([]);
    const grown = structuredClone(wrangler);
    grown.d1_databases = [{ binding: "DB" }];
    grown.services.push({ binding: "SEARCH", service: "search" });
    grown.durable_objects.bindings.push({
      name: "BOARDS",
      class_name: "BoardDO",
    });
    grown.r2_buckets.push({ binding: "FIGURES", bucket_name: "figures" });
    grown.triggers.crons.push("17 3 * * *");
    expect(classify(grown, region)).toEqual([
      "wrangler.jsonc d1_databases is not carried or excluded",
      "service SEARCH is not carried or excluded",
      "Durable Object BOARDS has no namespace",
      "R2 bucket FIGURES has no regional storage",
      "Unsupported cron for the regional timer: 17 3 * * *",
    ]);
    const careless = structuredClone(region);
    careless.excluded.routes = "no";
    careless.text.SIMULATION_DISPATCH = "queue";
    expect(classify(wrangler, careless)).toEqual([
      "excluded routes needs a reason",
      "SIMULATION_DISPATCH shadows a Production variable; declare it there",
    ]);
  });

  it("carries Production variables, SG13G2 through its operator path and host-local switches", async () => {
    const wrangler = await read("wrangler.jsonc");
    const region = await read("containers/canvas-cn/formal/region.jsonc");
    const config = renderConfig(wrangler, region);
    expect(config).toContain(
      '(name = "SG13G2_UPSTREAM_URL", text = "https://ngspice.canvas-operator.invalid/sg13g2")',
    );
    expect(config).toContain(
      '(name = "VACASK_PROFILE_ID", text = "vacask-sky130-candidate")',
    );
    expect(config).toContain(
      '(name = "PROJECT_WRITES_ENABLED", text = embed "/project-writes-enabled")',
    );
    expect(config).toContain(
      `compatibilityDate = "${wrangler.compatibility_date}"`,
    );
    expect(config).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b(?!:)/);
  });

  it("turns minute crons into systemd calendars", () => {
    expect(calendarOf("*/5 * * * *")).toBe("*-*-* *:00/5:00");
    expect(() => calendarOf("*/7 * * * *")).toThrow();
  });
});
