import { createEmptyProject, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { normalizeImportedProjectConductors } from "./project-conductor-normalization";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("imported Project conductor normalization", () => {
  it("repairs every legacy overlap in the imported copy only", () => {
    const project = createEmptyProject("legacy-overlap", "Legacy overlap");
    const document = project.documents[0]!;
    document.sourceStatus = "in-sync";
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      {
        id: "left",
        netId: "net",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "right",
        netId: "net",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
      {
        id: "top",
        netId: "net",
        position: { x: 50, y: 50 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "trunk",
        netId: "net",
        start: { kind: "junction", junctionId: "left" },
        end: { kind: "junction", junctionId: "right" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "overlapping-branch",
        netId: "net",
        start: { kind: "junction", junctionId: "top" },
        end: { kind: "junction", junctionId: "right" },
        bends: [{ x: 50, y: 0 }],
        modes: ["manual", "manual"],
      }),
    );

    const normalized = normalizeImportedProjectConductors(project, resolver);

    expect(normalized.changedDocumentIds).toEqual([document.id]);
    expect(normalized.project).not.toBe(project);
    expect(project.documents[0]!.routes).toHaveLength(2);
    expect(normalized.project.documents[0]).toMatchObject({
      revision: 1,
      sourceStatus: "geometry-only-changed",
    });
    expect(normalized.project.documents[0]!.routes).toHaveLength(3);
    expect(
      normalized.project.documents[0]!.junctions.some(
        (junction) => junction.position.x === 50 && junction.position.y === 0,
      ),
    ).toBe(true);
  });

  it("returns an already canonical Project without a synthetic revision", () => {
    const project = createEmptyProject("canonical", "Canonical");

    const normalized = normalizeImportedProjectConductors(project, resolver);

    expect(normalized).toEqual({ project, changedDocumentIds: [] });
    expect(normalized.project).toBe(project);
  });
});
