import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProject } from "@icm/project-protocol";

import { checkLayout } from "./layout-check";

const example = (name = "current-mirror-loaded-differential-pair") =>
  parseProject(
    readFileSync(
      new URL(`./examples/${name}.icproj.json`, import.meta.url),
      "utf8",
    ),
  );
const top = (project: ReturnType<typeof example>) =>
  project.documents.find((each) => each.id === project.topDocumentId)!;

describe("layout checks", () => {
  it("finds branch dots a grid step out of line, and none once they line up", () => {
    const project = example();
    const findings = checkLayout(project);
    expect(findings.map((finding) => finding.kind)).toEqual([
      "dots-misaligned",
      "dots-misaligned",
    ]);
    // Bring every branch dot onto the rows and columns its neighbours use.
    const dots = top(project).junctions;
    const rows = [...new Set(dots.map((dot) => dot.position.y))];
    const columns = [...new Set(dots.map((dot) => dot.position.x))];
    for (const dot of dots) {
      const row = rows.find(
        (y) => y !== dot.position.y && Math.abs(y - dot.position.y) <= 15,
      );
      const column = columns.find(
        (x) => x !== dot.position.x && Math.abs(x - dot.position.x) <= 15,
      );
      if (row !== undefined && row < dot.position.y) dot.position.y = row;
      if (column !== undefined && column < dot.position.x)
        dot.position.x = column;
    }
    expect(
      checkLayout(project).filter(
        (finding) => finding.kind === "dots-misaligned",
      ),
    ).toEqual([]);
  });

  it("finds twins that are not level, and names them", () => {
    // A fully differential stage: M2 and M3 are twins, drawn level and
    // mirrored.
    const project = example("fully-differential-two-stage-op-amp");
    const twins = () =>
      checkLayout(project).filter(
        (finding) => finding.kind === "asymmetric-pair",
      );
    expect(twins()).toEqual([]);
    const m2 = top(project).instances.find(
      (instance) => instance.reference === "M2",
    )!;
    m2.placement = {
      ...m2.placement!,
      position: { ...m2.placement!.position, y: m2.placement!.position.y + 10 },
    };
    expect(twins()).toEqual([
      expect.objectContaining({ devices: ["M2", "M3"] }),
    ]);
  });

  it("leaves a diff pair with a mirror load alone: its halves are not twins", () => {
    // The mirror's diode side and output side differ, so M3 and M4 do too.
    const project = example();
    const m4 = top(project).instances.find(
      (instance) => instance.reference === "M4",
    )!;
    m4.placement = {
      ...m4.placement!,
      position: { ...m4.placement!.position, y: m4.placement!.position.y + 10 },
    };
    expect(
      checkLayout(project).filter(
        (finding) => finding.kind === "asymmetric-pair",
      ),
    ).toEqual([]);
  });
});
