import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { flattenRichText } from "@icm/model";

import { tryParseProjectWithMetadata } from "./load.js";

/**
 * #463 retired the rule that capitalized an identifier's leading character.
 * Every format override authored before that carries the capital the old
 * compiler produced, so a terminal named `reset` has an override reading
 * `Reset` — and the schema refuses the whole Project, because a bound override
 * must still say the name it decorates.
 *
 * That commit repaired the one copy in this repository by hand. It could not
 * reach the copies already published, which is why a circuit on the gallery
 * wall stopped opening. A published circuit that will not open is, to its
 * author, a circuit that is gone, so loading repairs it.
 *
 * The case here is not invented: it is this repository's own gallery fixture
 * put back into the state #463 found it in, which is the state the published
 * copy is still in.
 */
const REPAIRED_FIXTURE = "fixtures/gallery-redline/2rmm2vb45f.icproj.json";

function publishedBeforeTheRuleChanged(): string {
  const repaired = readFileSync(REPAIRED_FIXTURE, "utf8");
  const broken = repaired.replace('"value": "r"', '"value": "R"');
  expect(broken).not.toBe(repaired);
  return broken;
}

describe("stale bound format overrides", () => {
  it("loads a Project the retired rule left behind instead of refusing it", () => {
    const result = tryParseProjectWithMetadata(publishedBeforeTheRuleChanged());

    if (!result.ok) {
      throw new Error(
        `Expected a repair, got: ${result.diagnostics
          .map((diagnostic) => diagnostic.message)
          .join("; ")}`,
      );
    }
    expect(result.ok).toBe(true);
  });

  it("restores the text the bound name actually reads", () => {
    const result = tryParseProjectWithMetadata(publishedBeforeTheRuleChanged());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const overrides = result.project.documents
      .flatMap((document) => document.annotations)
      .filter((annotation) => annotation.formatOverride)
      .map((annotation) => flattenRichText(annotation.formatOverride!));
    expect(overrides).toContain("reset");
    expect(overrides).not.toContain("Reset");
  });

  // Repair, not erasure: the only thing wrong was one character's case, and
  // the author's styling was never in question. The strongest way to say that
  // is that repairing the broken copy reproduces the repaired one exactly —
  // the same result #463 reached by hand, reached by loading.
  it("reproduces the hand-repaired file exactly", () => {
    const repaired = tryParseProjectWithMetadata(
      readFileSync(REPAIRED_FIXTURE, "utf8"),
    );
    const fromBroken = tryParseProjectWithMetadata(
      publishedBeforeTheRuleChanged(),
    );

    expect(repaired.ok).toBe(true);
    expect(fromBroken.ok).toBe(true);
    if (!repaired.ok || !fromBroken.ok) return;
    expect(fromBroken.project.documents).toEqual(repaired.project.documents);
  });

  it("leaves an already-correct Project untouched", () => {
    const result = tryParseProjectWithMetadata(
      readFileSync(REPAIRED_FIXTURE, "utf8"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const overrides = result.project.documents
      .flatMap((document) => document.annotations)
      .filter((annotation) => annotation.formatOverride)
      .map((annotation) => flattenRichText(annotation.formatOverride!));
    expect(overrides).toEqual(expect.arrayContaining(["reset", "XU2"]));
  });
});
