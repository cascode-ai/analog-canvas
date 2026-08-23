import {
  buildProjectConnectivityIndex,
  resolveDocumentLogicalNets,
  runErcChecks,
} from "@icm/derived";
import { CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  createLibraryExampleProject,
  libraryProjectExamples,
} from "./library-examples";

describe("bundled Library Project examples", () => {
  const resolver = new InMemorySymbolResolver(builtInSymbols);

  it("ships canonical, schema-current, openable Projects", () => {
    // Bundled examples can grow, so the contract is per-example rather than a
    // frozen count or single-document shape.
    expect(libraryProjectExamples.map((example) => example.id)).toEqual(
      expect.arrayContaining([
        "common-source-amplifier",
        "two-stage-op-amp",
        "current-mirror-loaded-differential-pair",
        "fully-differential-two-stage-op-amp",
      ]),
    );
    expect(
      new Set(libraryProjectExamples.map((example) => example.id)).size,
    ).toBe(libraryProjectExamples.length);
    for (const example of libraryProjectExamples) {
      expect(example.name.trim()).not.toBe("");
      expect(serializeProject(example.project)).toContain(
        `"schemaVersion": ${CURRENT_PROJECT_SCHEMA_VERSION}`,
      );
      expect(example.project.documents.length).toBeGreaterThanOrEqual(1);
      expect(
        example.project.documents.some(
          (document) => document.id === example.project.topDocumentId,
        ),
      ).toBe(true);
    }
  });

  it("ships no Example with unresolved MOS bulk semantics", () => {
    for (const example of libraryProjectExamples) {
      const diagnostics = runErcChecks(
        example.project,
        buildProjectConnectivityIndex(example.project, resolver),
        resolver,
      );
      expect(
        diagnostics.filter(
          (diagnostic) => diagnostic.code === "ERC_BULK_UNRESOLVED",
        ),
        example.id,
      ).toEqual([]);
    }
  });

  it("upgrades stored VDD rails into current Logical-Net power semantics", () => {
    for (const example of libraryProjectExamples) {
      for (const document of example.project.documents) {
        const railNetIds = new Set(
          document.routes.flatMap((route) =>
            route.presentation === "power-rail" ? [route.netId] : [],
          ),
        );
        const logicalNets = resolveDocumentLogicalNets(document);
        for (const netId of railNetIds) {
          expect(
            logicalNets.byBaseNetId.get(netId),
            `${example.id}:${document.id}:${netId}`,
          ).toMatchObject({
            name: "VDD",
            powerDomain: "vdd",
          });
        }
      }
    }
  });

  it("returns a fresh Project snapshot for every selected example", () => {
    const first = createLibraryExampleProject("common-source-amplifier");
    const second = createLibraryExampleProject("common-source-amplifier");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;
    first.name = "Changed only in this snapshot";
    expect(second.name).toBe("New Circuit");
    expect(createLibraryExampleProject("missing-example")).toBeNull();
  });
});
