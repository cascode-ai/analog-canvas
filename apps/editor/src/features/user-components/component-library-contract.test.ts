import { describe, expect, it } from "vitest";
import { ComponentLibrarySummarySchema } from "@icm/agent-adapter";
import { nativePackage } from "../../../../../worker/component-library.test-support";
import { summarizeSharedComponent } from "./component-library-contract";

describe("component discovery diagnostics", () => {
  it("retains model file and source location for invalid native source without accepting the package", () => {
    const payload = nativePackage();
    payload.circuit.source.files[0]!.text +=
      "\n.subckt extra A A\n.ends extra\n";
    const summary = ComponentLibrarySummarySchema.parse(
      summarizeSharedComponent({
        ...payload,
        id: "bad-source",
        revision: 1,
        authorId: "alice",
        author: "Alice",
        status: "shared",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      }),
    );
    expect(summary).toMatchObject({
      capability: "needs-repair",
      diagnostics: [
        expect.objectContaining({
          componentId: "bad-source",
          path: ["circuit", "source"],
          file: payload.circuit.source.files[0]!.path,
          sourceRef: expect.any(Object),
          message: "Model terminal names must be unique",
          recovery: "edit-definition",
        }),
      ],
    });
    expect(summary).not.toHaveProperty("circuit");
  });
});
