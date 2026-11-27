import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  parseProjectSnapshot,
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
});
