import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  parseProjectSnapshot,
  shareProjectSnapshot,
  validateProjectSnapshot,
  validateProjectResult,
  CircuitProjectSchema,
  validatePlacementProjectSnapshot,
} from "./index.js";

describe("owned placement snapshot", () => {
  it("rechecks a peer Cell from a fingerprinted public receipt", () => {
    const project = createEmptyProject("p", "Drawing", "top");
    project.documents.push(createEmptyDocument("peer", "Peer"));
    const mutable = validateProjectResult(project);
    if (!mutable.success) throw mutable.error;
    Object.assign(mutable.data.documents[1]!, { unexpected: undefined });
    const prior = parseProjectSnapshot(mutable.data);
    const candidate = {
      ...prior,
      documents: [{ ...prior.documents[0]!, revision: 1 }, prior.documents[1]!],
    };
    const expected = CircuitProjectSchema.safeParse(candidate);
    expect(expected.success).toBe(false);
    expect(
      validatePlacementProjectSnapshot(candidate, prior).error?.issues,
    ).toEqual(expected.error?.issues);
  });
  it("validates borrowed Cells against an immutable source and preserves canonical refusals", () => {
    const source = createEmptyProject("p", "Drawing", "top");
    source.documents.push(createEmptyDocument("peer", "Peer"));
    const previous = parseProjectSnapshot(source);
    const candidate = {
      ...previous,
      documents: [
        { ...previous.documents[0]!, revision: 1 },
        previous.documents[1]!,
      ],
    };
    const checked = validatePlacementProjectSnapshot(candidate, previous);
    expect(checked.success).toBe(true);
    if (!checked.success) return;
    expect(checked.data.documents[1]).toBe(previous.documents[1]);
    expect(Object.isFrozen(checked.data)).toBe(true);
    const invalid = structuredClone(source);
    Object.assign(invalid.documents[1]!, { unexpected: true });
    for (const prior of [invalid, previous]) {
      const result = validatePlacementProjectSnapshot(invalid, prior);
      const canonical = validateProjectSnapshot(invalid);
      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual(canonical.error?.issues);
    }
    const crossCell = { ...candidate, topDocumentId: "absent" };
    expect(
      validatePlacementProjectSnapshot(crossCell, previous).error?.issues,
    ).toEqual(validateProjectSnapshot(crossCell).error?.issues);
  });
  it("detaches changed branches while reusing unchanged Cells when sharing a public receipt", () => {
    const base = createEmptyProject("p", "Drawing", "top");
    base.documents.push(createEmptyDocument("peer", "Peer"));
    const previous = parseProjectSnapshot(base);
    const mutable = validateProjectResult({
      ...structuredClone(base),
      documents: [
        { ...structuredClone(base.documents[0]!), name: "Edited Top" },
        structuredClone(base.documents[1]!),
      ],
    });
    if (!mutable.success) throw mutable.error;
    const shared = shareProjectSnapshot(previous, mutable.data);
    // Unchanged peer Cell is reference-shared with previous; changed top Cell is detached.
    expect(shared.documents[1]).toBe(previous.documents[1]);
    expect(shared.documents[0]).not.toBe(mutable.data.documents[0]);
    expect(Object.isFrozen(shared.documents[0])).toBe(true);
    mutable.data.documents[0]!.name = "Mutated After Share";
    expect(shared.documents[0]!.name).toBe("Edited Top");
  });
});
