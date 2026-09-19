import { describe, expect, it } from "vitest";
import { documentsReachableFromTop } from "./cell-hierarchy-tree";

describe("hierarchy tree membership", () => {
  it("uses structural calls including zero-port and repeated cells, terminating cycles", () => {
    const calls = [
      { parentDocumentId: "top", childDocumentId: "empty", instanceId: "X1" },
      { parentDocumentId: "top", childDocumentId: "empty", instanceId: "X2" },
      { parentDocumentId: "empty", childDocumentId: "top", instanceId: "back" },
      {
        parentDocumentId: "unused",
        childDocumentId: "other",
        instanceId: "X3",
      },
    ];
    expect([...documentsReachableFromTop("top", calls)]).toEqual([
      "top",
      "empty",
    ]);
    expect([...documentsReachableFromTop("unused", calls)]).toEqual([
      "unused",
      "other",
    ]);
  });
});
