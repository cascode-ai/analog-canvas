/**
 * The red line over real published circuits: same-Net conductor
 * canonicalization must never change terminal connectivity. The fixtures are
 * snapshots of Gallery documents users actually drew — including the exact
 * pathologies from the wire-handling feedback — so a failure here means
 * canonicalization altered real users' circuits, not a synthetic case.
 *
 * fixtures/gallery-redline/README.md documents the corpus and its refresh
 * procedure. Healing statistics are deliberately NOT asserted: they drift as
 * users draw; the invariant does not.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseProject } from "@icm/project-protocol";
import { deriveElectricalTopologyProjection } from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { normalizeSameNetConductorTopology } from "./conductor-topology.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const CORPUS = resolve(process.cwd(), "fixtures/gallery-redline");

describe("conductor canonicalization red line over the gallery corpus", () => {
  const files = readdirSync(CORPUS).filter((name) =>
    name.endsWith(".icproj.json"),
  );

  it("covers the documented corpus", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files).toContain("ycg43babwa.icproj.json");
  });

  it.each(files)("%s: terminal connectivity survives", (file) => {
    const project = parseProject(readFileSync(resolve(CORPUS, file), "utf8"));
    for (const document of project.documents) {
      const before = deriveElectricalTopologyProjection(document, resolver);
      const beforeNetIds = new Set(document.nets.map((net) => net.id));
      const result = normalizeSameNetConductorTopology(document, resolver);
      const after = deriveElectricalTopologyProjection(document, resolver);

      const violations: string[] = [];
      for (const [key, netId] of before.endpointToBaseNet) {
        const afterNet = after.endpointToBaseNet.get(key);
        if (afterNet === netId) continue;
        // A junction endpoint may vanish, but only when the normalizer
        // itself reported it coalesced onto that very Net — a degree-two
        // anchor folding into the conductor it already belonged to.
        if (
          afterNet === undefined &&
          result.coalescedEndpoints.get(key) === netId
        ) {
          continue;
        }
        violations.push(
          `${document.id} ${key}: ${netId} -> ${afterNet ?? "gone"}`,
        );
      }
      for (const [key, netId] of after.endpointToBaseNet) {
        if (before.endpointToBaseNet.has(key)) continue;
        // Branch-vertex materialization is the pass's own documented
        // behavior: where a same-Net vertex rests on another conductor, an
        // explicit junction-canonical-* anchor appears ON AN EXISTING NET.
        // That is structure, not an electrical change — do NOT "fix" this
        // admission away, or every materialized T-vertex becomes a false
        // connectivity alarm (it did, on this criterion's first draft).
        if (
          key.startsWith("junction:junction-canonical-") &&
          beforeNetIds.has(netId)
        ) {
          continue;
        }
        violations.push(`${document.id} endpoint appeared: ${key} on ${netId}`);
      }

      expect(
        violations,
        `Canonicalization altered real users' circuits (${file}). ` +
          "Terminal connectivity must be identical before and after " +
          "normalizeSameNetConductorTopology; see fixtures/gallery-redline/README.md.",
      ).toEqual([]);
    }
  });
});
