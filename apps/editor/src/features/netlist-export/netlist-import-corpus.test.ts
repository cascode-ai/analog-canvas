import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  importNetlistSources,
  type NetlistImportPolicy,
} from "./netlist-source-import.js";

/**
 * The public netlist import corpus (#2294): small synthetic Spectre and
 * SPICE designs, each with what its import is expected to give, statement
 * by statement. A change to how a statement imports shows here as a diff to
 * review. `ICM_UPDATE_IMPORT_CORPUS=1` rewrites the expectations.
 */
const CORPUS = resolve(
  import.meta.dirname,
  "../../../../../fixtures/netlist-import",
);

interface CorpusCase {
  about: string;
  entry: string;
  policy?: NetlistImportPolicy;
}

function sources(directory: string) {
  return readdirSync(directory)
    .filter((name) => name !== "case.json" && name !== "expected.json")
    .sort()
    .map((name) => ({
      path: name,
      bytes: readFileSync(join(directory, name)),
    }));
}

async function outcome(directory: string) {
  const spec = JSON.parse(
    readFileSync(join(directory, "case.json"), "utf8"),
  ) as CorpusCase;
  const result = await importNetlistSources(
    sources(directory),
    spec.entry,
    spec.policy ?? {},
  );
  const instances =
    result.status === "imported"
      ? result.project.documents
          .flatMap((document) => document.instances)
          .filter(({ importProvenance }) => importProvenance)
          .map(
            ({ reference, symbolId, importProvenance }) =>
              `${reference} ${importProvenance!.kind}:${importProvenance!.sourceMasterName}${importProvenance!.status ? ` ${importProvenance!.status}` : ""} ${/^untyped|^external/u.test(symbolId) ? symbolId.split("-")[0] : symbolId}`,
          )
          .sort()
      : [];
  return {
    status: result.status,
    complete: result.ledger.complete,
    ledger: result.ledger.entries.map(
      ({ path, line, fate, reason }) =>
        `${path}:${line} ${fate}${reason ? ` (${reason.slice(0, 80)})` : ""}`,
    ),
    instances,
    findings: result.diagnostics
      .filter(({ severity }) => severity !== "info")
      .map(({ severity, code, message }) => `${severity} ${code}: ${message}`),
  };
}

describe("netlist import corpus", () => {
  for (const name of readdirSync(CORPUS).sort()) {
    const directory = join(CORPUS, name);
    it(name, async () => {
      const actual = await outcome(directory);
      const expectedPath = join(directory, "expected.json");
      if (process.env.ICM_UPDATE_IMPORT_CORPUS === "1")
        writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`);
      const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
      expect(actual).toEqual(expected);
      // Every statement of an import that reached the ledger has a fate.
      if (actual.ledger.length) expect(actual.complete).toBe(true);
    });
  }
});
