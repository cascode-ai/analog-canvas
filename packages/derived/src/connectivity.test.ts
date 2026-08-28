/**
 * Wire-transform audit batch 4, #17: the shared per-document connectivity
 * context must be observationally identical to the per-net derivation —
 * it exists purely to stop an all-nets sweep from re-deriving full-document
 * contact evidence and routing geometry once per net.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseProject } from "@icm/project-protocol";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  deriveNetConnectivity,
  deriveNetConnectivityContext,
} from "./connectivity.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("shared connectivity context (#17)", () => {
  it("context-shared derivation matches the per-net derivation exactly", () => {
    const document = parseProject(
      readFileSync(
        resolve(
          process.cwd(),
          "fixtures/projects/phase-3-routing/project.icproj.json",
        ),
        "utf8",
      ),
    ).documents[0]!;
    const context = deriveNetConnectivityContext(document, resolver);
    expect(document.nets.length).toBeGreaterThan(0);
    for (const net of document.nets) {
      expect(deriveNetConnectivity(document, resolver, net, context)).toEqual(
        deriveNetConnectivity(document, resolver, net),
      );
    }
  });
});
