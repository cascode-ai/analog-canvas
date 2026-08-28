import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";

import {
  authoredObjectCount,
  projectHasMeaningfulContent,
  projectTextHasMeaningfulContent,
} from "./project-content";

const textObject = (id: string) => ({
  id,
  kind: "text" as const,
  locked: false,
  zIndex: 0,
  anchor: { kind: "free" as const, position: { x: 10, y: 10 } },
  content: { runs: [{ kind: "text" as const, value: id }] },
  alignment: "start" as const,
  rotation: 0 as const,
});

describe("meaningful content threshold", () => {
  it("prompts only at three or more authored objects", () => {
    const project = createEmptyProject("project-blank", "Blank");
    expect(authoredObjectCount(project)).toBe(0);
    expect(projectHasMeaningfulContent(project)).toBe(false);

    const sketch = structuredClone(project);
    sketch.documents[0]!.drafting!.objects.push(
      textObject("note-1"),
      textObject("note-2"),
    );
    expect(projectHasMeaningfulContent(sketch)).toBe(false);

    sketch.documents[0]!.drafting!.objects.push(textObject("note-3"));
    expect(projectHasMeaningfulContent(sketch)).toBe(true);

    // Emptying the circuit back out drops the protection again.
    sketch.documents[0]!.drafting!.objects.length = 0;
    expect(projectHasMeaningfulContent(sketch)).toBe(false);
  });

  it("evaluates serialized snapshots tolerantly", () => {
    expect(projectTextHasMeaningfulContent("not json")).toBe(false);
    const project = createEmptyProject("project-snap", "Snap");
    project.documents[0]!.drafting!.objects.push(
      textObject("a"),
      textObject("b"),
      textObject("c"),
    );
    expect(projectTextHasMeaningfulContent(JSON.stringify(project))).toBe(true);
  });
});
