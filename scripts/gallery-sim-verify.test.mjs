import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { localSimulationCheck } from "../apps/editor/src/headless/simulation-check.ts";
import { routeGalleryRequest } from "../worker/gallery.ts";
import { dividerProjectText } from "../worker/gallery-simulation-checks.test-support.ts";
import {
  ORIGIN,
  asReader,
  environment,
  makerOf,
  ownerAccountOf,
  projectText,
  submitOne,
} from "../worker/gallery.test-support.ts";
import {
  UsageError,
  describeResult,
  parseArguments,
  verifyEntries,
} from "./gallery-sim-verify.mjs";

function ngspiceOnPath() {
  return spawnSync("ngspice", ["--version"], { encoding: "utf8" }).status === 0;
}

describe("gallery-sim-verify arguments", () => {
  it("takes ids or --all, dry run unless --apply", () => {
    const home = "/nowhere";
    expect(parseArguments(["g-1", "g-2"], {}, home)).toMatchObject({
      ids: ["g-1", "g-2"],
      all: false,
      apply: false,
      models: null,
    });
    expect(
      parseArguments(
        ["--all", "--apply", "--models", "/m/sky130.lib.spice"],
        {},
        home,
      ),
    ).toMatchObject({ all: true, apply: true, models: "/m/sky130.lib.spice" });
    const cells = parseArguments(["g-1"], {}, home).libraries;
    expect(Object.values(cells)).toEqual([
      expect.stringMatching(/containers\/ngspice\/cells\/.+\.spice$/u),
    ]);
    expect(
      parseArguments(["g-1", "--library", "cells=/c/cells.spice"], {}, home)
        .libraries,
    ).toEqual({ ...cells, cells: "/c/cells.spice" });
    expect(
      parseArguments(["g-1"], { ANALOG_CANVAS_SKY130_LIB: "/l.spice" }, home)
        .models,
    ).toBe("/l.spice");
    for (const argv of [[], ["--all", "g-1"], ["g-1", "--library", "x"]])
      expect(() => parseArguments(argv, {}, home)).toThrow(UsageError);
    expect(() =>
      parseArguments(["g-1", "--origin", "http://example.com"], {}, home),
    ).toThrow(/https/u);
  });
});

describe("gallery-sim-verify against the Gallery's routes", () => {
  /** The Worker's Gallery, reached as the script reaches it, with a token. */
  async function gallery() {
    const env = environment();
    const maker = await makerOf(env);
    const owner = await ownerAccountOf(env);
    const { token } = await (
      await env.authDurable.fetch(
        new Request(`${ORIGIN}/api/auth/owner-tokens`, {
          method: "POST",
          headers: { Origin: ORIGIN, Cookie: owner },
          body: JSON.stringify({ label: "simulation machine" }),
        }),
      )
    ).json();
    const fetchImpl = async (url, init) =>
      routeGalleryRequest(asReader(new Request(url, init)), env);
    const checkOf = async (id) =>
      (
        await (
          await fetchImpl(`${ORIGIN}/api/gallery/${id}/simulation-check`, {
            headers: { Cookie: maker },
          })
        ).json()
      ).check;
    const run = (options) =>
      verifyEntries({
        origin: ORIGIN,
        token,
        check: localSimulationCheck,
        simulator: { ngspice: "ngspice", libraries: {} },
        fetchImpl,
        ids: [],
        all: false,
        apply: false,
        ...options,
      });
    return { env, maker, checkOf, run };
  }

  it("records nothing it could not run", async () => {
    const { env, maker, checkOf, run } = await gallery();
    const divider = await submitOne(env, "Divider", {
      cookie: maker,
      text: dividerProjectText("Divider", "vmid range 0.45 0.55 unit=V"),
    });
    const plain = await submitOne(env, "Plain", {
      cookie: maker,
      text: projectText("Plain"),
    });
    const results = await run({
      all: true,
      apply: true,
      simulator: { ngspice: "/nonexistent/ngspice", libraries: {} },
    });
    expect(results).toEqual([
      expect.objectContaining({ id: divider, outcome: "cannot-run" }),
    ]);
    expect(describeResult(results[0])).toMatch(
      /^cannot run {2}\S+ \(Divider\): Divider DC: ngspice-unavailable/u,
    );
    expect(await checkOf(divider)).toBeNull();
    expect(await run({ ids: [plain, "unknown-1"] })).toEqual([
      expect.objectContaining({ id: plain, reason: "no testbench" }),
      expect.objectContaining({ id: "unknown-1", reason: "not-found" }),
    ]);
  });

  // Skips cleanly where ngspice is absent.
  it.skipIf(!ngspiceOnPath())(
    "runs each testbench with ngspice, and records its verdict only with --apply",
    async () => {
      const { env, maker, checkOf, run } = await gallery();
      const passing = await submitOne(env, "Divider", {
        cookie: maker,
        text: dividerProjectText("Divider", "vmid range 0.45 0.55 unit=V"),
      });
      const failing = await submitOne(env, "Divider, tight", {
        cookie: maker,
        text: dividerProjectText("Divider, tight", "vmid > 0.9 unit=V"),
      });
      const dry = await run({ all: true });
      expect(dry.map((result) => result.outcome)).toEqual(["pass", "fail"]);
      expect(dry.map(describeResult)).toEqual([
        `pass        ${passing} (Divider)`,
        `fail        ${failing} (Divider, tight): Divider DC: vmid = 0.5 V, wants > 0.9 (outside-spec)`,
      ]);
      expect(await checkOf(passing)).toBeNull();

      const applied = await run({ ids: [passing, failing], apply: true });
      expect(applied.map((result) => result.recorded)).toEqual([true, true]);
      expect(await checkOf(passing)).toMatchObject({
        status: "pass",
        origin: "local",
        rule: 1,
      });
      expect(await checkOf(failing)).toMatchObject({
        status: "fail",
        reason: "outside-spec",
        origin: "local",
      });
    },
  );
});
