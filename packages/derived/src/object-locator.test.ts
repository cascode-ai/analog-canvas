import {
  HierarchyFrameSchema as ModelHierarchyFrameSchema,
  ObjectLocatorSchema as ModelObjectLocatorSchema,
} from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  directObjectLocator,
  HierarchyFrameSchema,
  ObjectLocatorSchema,
} from "./object-locator.js";

describe("derived object locator facade", () => {
  it("reexports the canonical model schemas rather than defining copies", () => {
    expect(ObjectLocatorSchema).toBe(ModelObjectLocatorSchema);
    expect(HierarchyFrameSchema).toBe(ModelHierarchyFrameSchema);
  });

  it("constructs direct locators with the canonical empty hierarchy path", () => {
    expect(directObjectLocator("main", "net", "net-1")).toEqual({
      documentId: "main",
      hierarchyPath: [],
      kind: "net",
      objectId: "net-1",
    });
  });
});
