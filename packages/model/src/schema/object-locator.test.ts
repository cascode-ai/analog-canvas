import { describe, expect, it } from "vitest";

import { ObjectLocatorSchema } from "./object-locator.js";

describe("object locator contract", () => {
  it("round-trips a hierarchy-aware terminal locator without changing JSON", () => {
    const locator = {
      documentId: "child",
      hierarchyPath: [
        {
          parentDocumentId: "top",
          instanceId: "X1",
          childDocumentId: "child",
        },
      ],
      kind: "terminal" as const,
      objectId: "M1:G",
      endpoint: { kind: "terminal" as const, instanceId: "M1", pinName: "G" },
      sourceRef: {
        fileId: "design.sp",
        start: { offset: 12, line: 2, column: 1 },
        end: { offset: 24, line: 2, column: 13 },
      },
    };

    expect(ObjectLocatorSchema.parse(locator)).toEqual(locator);
  });

  it("keeps the contract strict", () => {
    expect(() =>
      ObjectLocatorSchema.parse({
        documentId: "top",
        hierarchyPath: [],
        kind: "instance",
        objectId: "M1",
        legacyPath: [],
      }),
    ).toThrow();
  });
});
