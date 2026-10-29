import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { describe, expect, it } from "vitest";
import { exerciseGalleryEntry } from "./gallery-entry";

function resistor() {
  const project = createEmptyProject("gallery-source", "Gallery source");
  project.documents[0]!.instances.push({
    id: "R1",
    reference: "R1",
    symbolId: "resistor",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { value: "1k" },
    },
  });
  return project;
}

describe("Gallery census through the editor commands", () => {
  it("records both failures when the drawing cannot be read", async () => {
    const result = await exerciseGalleryEntry("{ not a project");
    expect(result.open).toMatchObject({
      status: "failed",
      message: expect.stringContaining("could not be opened"),
    });
    expect(result.insert).toMatchObject({
      status: "failed",
      message: expect.stringContaining("could not be opened"),
    });
  });

  it("does not count a rejected placement as insertion success", async () => {
    const project = resistor();
    project.documents[0]!.presentation.styleProfileId = "other-style-profile";
    const result = await exerciseGalleryEntry(serializeProject(project));
    expect(result.open.status).toBe("opened");
    expect(result.insert).toMatchObject({
      status: "failed",
      message: expect.stringContaining("different style profiles"),
    });
  });

  it("rejects opening when the editor cannot resolve a component definition", async () => {
    const project = resistor();
    project.documents[0]!.instances[0]!.symbolId = "missing-component";
    const result = await exerciseGalleryEntry(JSON.stringify(project));
    expect(result.open).toMatchObject({
      status: "failed",
      message: expect.stringContaining("missing component definition"),
    });
  });

  it("reports a legacy Symbol Library mismatch as insertion failure", async () => {
    const project = resistor();
    project.symbolLibrary.hash = "older-library-lock";
    const result = await exerciseGalleryEntry(serializeProject(project));
    expect(result.open.status).toBe("opened");
    expect(result.insert).toMatchObject({
      status: "failed",
      message: expect.stringContaining("incompatible Symbol Library"),
    });
  });

  it("reports a commit exceeding the transaction edit limit as failure", async () => {
    const project = resistor();
    const prototype = project.documents[0]!.instances[0]!;
    project.documents[0]!.instances = Array.from(
      { length: 1025 },
      (_, index) => ({
        ...structuredClone(prototype),
        id: `resistor-${index}`,
        reference: `R${index + 1}`,
        placement: {
          position: { x: index * 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      }),
    );
    const result = await exerciseGalleryEntry(serializeProject(project));
    expect(result.open.status).toBe("opened");
    expect(result.insert).toMatchObject({
      status: "failed",
      message: expect.stringContaining(
        "Placement commit: Transaction schema validation failed",
      ),
    });
  });

  it("commits on the finer grid without moving the source geometry", async () => {
    const project = resistor();
    project.documents[0]!.presentation.grid = 1;
    project.documents[0]!.instances[0]!.placement!.position = { x: 65, y: 47 };
    const result = await exerciseGalleryEntry(serializeProject(project));
    expect(result.insert.status).toBe("inserted");
    if (result.insert.status !== "inserted")
      throw new Error("Expected insertion");
    expect(result.insert.adoptedGrid).toBe(1);
    expect(result.insert.project.documents[0]!.presentation.grid).toBe(1);
    expect(
      result.insert.project.documents[0]!.instances[0]!.placement!.position,
    ).toEqual({ x: 65, y: 47 });
  });

  it("records an empty drawing's open fallback without claiming it inserted", async () => {
    const result = await exerciseGalleryEntry(
      serializeProject(createEmptyProject("empty", "Empty")),
    );
    expect(result.open.status).toBe("opened");
    expect(result.insert.status).toBe("opened-empty");
  });

  it("opens the source and commits its drawing into a separate fresh canvas", async () => {
    const result = await exerciseGalleryEntry(serializeProject(resistor()));
    expect(result.open.status).toBe("opened");
    expect(result.insert.status).toBe("inserted");
    if (result.open.status !== "opened" || result.insert.status !== "inserted")
      throw new Error("Expected both Gallery paths to succeed");
    expect(result.open.project.id).toBe("gallery-source");
    expect(result.insert.project.id).toBe("census-target");
    expect(result.insert.project.documents[0]!.instances).toEqual([
      expect.objectContaining({ reference: "R1", symbolId: "resistor" }),
    ]);
    expect(result.insert.project.documents[0]!.revision).toBeGreaterThan(0);
  });
});
