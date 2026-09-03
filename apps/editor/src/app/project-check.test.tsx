import { createEmptyProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { buildProjectConnectivityIndex, diagnoseProject } from "@icm/derived";
import * as erc from "../../../../packages/derived/src/diagnostics/erc";
import * as visual from "../../../../packages/derived/src/visual";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  projectCheckIdentity,
  projectCheckStatus,
  runProjectCheck,
} from "./project-check";
import { useEditorDerivedModel } from "./use-editor-derived-model";
import { useProjectCheck } from "./use-project-check";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const project = createEmptyProject("check", "Check");
  project.documents[0]!.instances.push({
    id: "R1",
    reference: "R1",
    symbolId: "resistor",
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
  });
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const index = buildProjectConnectivityIndex(project, resolver);
  const identity = projectCheckIdentity(project, "session-1", resolver);
  return { project, resolver, index, identity };
}

describe("explicit Project checking", () => {
  it("collects both producers once and preserves full diagnostic output", () => {
    const { project, resolver, index, identity } = fixture();
    const expected = diagnoseProject(project, resolver, index);
    const electrical = vi.spyOn(erc, "runErcChecks");
    const geometry = vi.spyOn(visual, "diagnoseVisualQuality");
    const result = runProjectCheck(project, identity, index);
    expect(result.snapshot?.diagnostics).toEqual(expected);
    expect(electrical).toHaveBeenCalledTimes(1);
    expect(geometry).toHaveBeenCalledTimes(project.documents.length);
    expect(result.visualByDocument.has(project.documents[0]!.id)).toBe(true);
    expect(result).not.toHaveProperty("project");
    expect(result).not.toHaveProperty("index");
  });

  it("invalidates document, structure, resolver and session changes without recomputing", () => {
    const { project, resolver, index, identity } = fixture();
    const result = runProjectCheck(project, identity, index);
    const electrical = vi.spyOn(erc, "runErcChecks");
    expect(projectCheckStatus(null, identity)).toBe("unchecked");
    expect(projectCheckStatus(result, identity)).toBe("current");
    const edited = structuredClone(project);
    edited.documents[0]!.revision++;
    expect(
      projectCheckStatus(
        result,
        projectCheckIdentity(edited, identity.sessionId, resolver),
      ),
    ).toBe("stale");
    const structural = {
      ...project,
      structureRevision: project.structureRevision + 1,
    };
    expect(
      projectCheckStatus(
        result,
        projectCheckIdentity(structural, identity.sessionId, resolver),
      ),
    ).toBe("stale");
    expect(
      projectCheckStatus(result, {
        ...identity,
        resolver: new InMemorySymbolResolver(builtInSymbols),
      }),
    ).toBe("stale");
    expect(
      projectCheckStatus(result, { ...identity, sessionId: "other" }),
    ).toBe("unchecked");
    expect(electrical).not.toHaveBeenCalled();
  });

  it("represents execution failure separately from a clean check", () => {
    const { project, index, identity } = fixture();
    vi.spyOn(erc, "runErcChecks").mockImplementation(() => {
      throw new Error("broken producer");
    });
    const result = runProjectCheck(project, identity, index);
    expect(projectCheckStatus(result, identity)).toBe("failed");
    expect(result.snapshot).toBeNull();
    expect(result.error).toBe("broken producer");
  });

  it("rendering the editor read model and check controller never executes diagnostics", () => {
    const { project, resolver, index } = fixture();
    const electrical = vi.spyOn(erc, "runErcChecks");
    const geometry = vi.spyOn(visual, "diagnoseVisualQuality");
    function Harness() {
      useEditorDerivedModel({
        project,
        document: project.documents[0]!,
        resolver,
        projectConnectivityIndex: index,
        documentStack: [],
        highlightedNetOrigin: null,
        selectedHighlightNetId: null,
        selectedHighlightEndpoint: undefined,
        searchActive: false,
        searchQuery: "",
        routingGuidanceView: "all",
        wireSource: null,
        bulkDrawInstanceId: null,
      });
      const check = useProjectCheck({
        project,
        sessionId: "session",
        resolver,
        index,
        save: async () => ({ status: "signed-out" }),
        isSaving: () => false,
        openIssues: () => undefined,
      });
      return <output>{check.status}</output>;
    }
    expect(renderToStaticMarkup(<Harness />)).toContain("unchecked");
    project.documents[0]!.revision++;
    renderToStaticMarkup(<Harness />);
    expect(electrical).not.toHaveBeenCalled();
    expect(geometry).not.toHaveBeenCalled();
  });
});
