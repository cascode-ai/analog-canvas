import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { createBrowserRecoveryStore } from "./browser-recovery-store";
import { recoveryRecordOf } from "./recovery-coordinator";
import {
  createProjectWorkspaceStore,
  type ProjectWorkspace,
} from "./project-workspace";
import {
  findWorkspaceReopenOffer,
  forgetDeletedCloudProjects,
  holdsUnsavedWork,
  keepDisplacedTabs,
  planWorkspaceReopen,
  workspaceReopenSummary,
  worthReopening,
} from "./workspace-reopen";

function tab(name: string, facts: Record<string, unknown> = {}) {
  return {
    id: `tab-${name}`,
    session: {
      projectText: JSON.stringify({ name, documents: [] }),
      dirty: false,
      unsafe: false,
      publication: null,
      file: { cloudBinding: null, nativeBinding: null },
      ...facts,
    },
  };
}
/** A tab as the editor saves it, holding a real Project. */
function savedTab(
  id: string,
  project: CircuitProject,
  facts: { dirty?: boolean; unsafe?: boolean; cloudId?: string } = {},
) {
  const bound = facts.cloudId !== undefined;
  return {
    id,
    session: {
      projectText: serializeProject(project),
      dirty: facts.dirty ?? false,
      unsafe: facts.unsafe ?? false,
      publication: bound ? { id: "gallery-entry" } : null,
      recovery: {
        workingCopyId: `working-copy-${id}`,
        source: bound ? "cloud-project" : "new",
      },
      file: {
        nativeBinding: null,
        persistenceState: facts.dirty ? "dirty" : bound ? "clean" : "unbound",
        cloudBinding: bound
          ? { id: facts.cloudId, revision: 4, galleryEntryId: null }
          : null,
        savedBaseline: bound
          ? { project, viewBox: { x: 0, y: 0, width: 10, height: 10 } }
          : null,
        safeSnapshotToken: null,
      },
    },
  };
}
function windowRecord(
  windowId: string,
  savedAt: number,
  tabs: { id: string; session: unknown }[],
): ProjectWorkspace {
  return {
    version: 1,
    windowId,
    url: "/editor",
    savedAt,
    activeId: tabs[0]!.id,
    tabs,
  };
}

describe("reopening a closed window's tabs (#1250)", () => {
  it("offers only tabs worth reopening", () => {
    const blank = windowRecord("a", 1, [tab("New Circuit")]);
    expect(worthReopening(blank)).toBe(false);
    for (const facts of [
      { dirty: true },
      { unsafe: true },
      { publication: { id: "gallery-1" } },
      { file: { cloudBinding: { id: "cloud-1" }, nativeBinding: null } },
      { file: { cloudBinding: null, nativeBinding: { name: "a.icproj" } } },
    ])
      expect(
        worthReopening(
          windowRecord("a", 1, [tab("New Circuit"), tab("Bandgap", facts)]),
        ),
      ).toBe(true);
  });

  it("names every tab, and an unreadable name never blocks the offer", () => {
    const record = windowRecord("a", 42, [
      tab("Bandgap", { dirty: true }),
      { id: "tab-x", session: { projectText: "{not json" } },
      { id: "tab-y", session: { projectText: JSON.stringify({ name: " " }) } },
    ] as ReturnType<typeof tab>[]);
    expect(workspaceReopenSummary(record)).toEqual({
      savedAt: 42,
      names: ["Bandgap", "Untitled", "Untitled"],
    });
  });

  it("skips open windows and blank ones, and offers nothing when open windows are unknown", async () => {
    const store = createProjectWorkspaceStore(new IDBFactory());
    await store.write(windowRecord("work", 1, [tab("OTA", { dirty: true })]));
    await store.write(windowRecord("blank", 3, [tab("New Circuit")]));
    await store.write(
      windowRecord("still-open", 5, [tab("Mixer", { dirty: true })]),
    );
    const offer = await findWorkspaceReopenOffer(
      store,
      "fresh",
      new Set(["still-open", "fresh"]),
    );
    expect(offer?.record.windowId).toBe("work");
    expect(offer?.summary.names).toEqual(["OTA"]);
    expect(await findWorkspaceReopenOffer(store, "fresh", null)).toBeNull();
    store.close();
  });
});

describe("tabs with unsaved work survive Reopen tabs and a fresh page (#1599)", () => {
  const alpha = createEmptyProject("project-alpha", "Alpha");
  const beta = createEmptyProject("project-beta", "Beta", "document-beta");
  const gamma = createEmptyProject("project-gamma", "Gamma");

  it("reopens unsaved edits to a Cloud Project open here as an unsaved copy", () => {
    const closed = windowRecord("closed", 1, [
      savedTab("open-clean", alpha, { cloudId: "cloud-alpha" }),
      savedTab("open-edited", beta, { cloudId: "cloud-beta", dirty: true }),
      savedTab("elsewhere", gamma, { cloudId: "cloud-gamma", dirty: true }),
      savedTab("draft", gamma, { unsafe: true }),
    ]);
    const plan = planWorkspaceReopen(
      closed,
      new Set(["cloud-alpha", "cloud-beta"]),
    );
    // Only the clean tab of a Project open here stays behind.
    expect(plan.map(({ id, copy }) => [id, copy])).toEqual([
      ["open-edited", true],
      ["elsewhere", false],
      ["draft", false],
    ]);
    for (const { id, session } of closed.tabs)
      if (holdsUnsavedWork(session))
        expect(plan.map((tab) => tab.id)).toContain(id);

    const copy = plan[0]!.session as ReturnType<typeof savedTab>["session"];
    const project = parseProject(copy.projectText);
    expect(project.name).toBe("Beta (unsaved copy)");
    expect(project.id).not.toBe(beta.id);
    expect(project.documents).toEqual(
      parseProject(serializeProject(beta)).documents,
    );
    // Bound to nothing, it can save over neither the open tab nor the Cloud.
    expect(copy).toMatchObject({
      dirty: true,
      unsafe: true,
      publication: null,
      recovery: { workingCopyId: "working-copy-open-edited" },
      file: {
        cloudBinding: null,
        savedBaseline: null,
        persistenceState: "dirty",
      },
    });
    // A tab of a Project not open here keeps its binding.
    expect(plan[1]!.session).toBe(closed.tabs[2]!.session);

    const long = createEmptyProject("project-long", "L".repeat(120));
    const [longCopy] = planWorkspaceReopen(
      windowRecord("closed", 1, [
        savedTab("long", long, { cloudId: "cloud-long", dirty: true }),
      ]),
      new Set(["cloud-long"]),
    );
    const longName = parseProject(
      (longCopy!.session as { projectText: string }).projectText,
    ).name;
    expect(longName).toHaveLength(120);
    expect(longName.endsWith(" (unsaved copy)")).toBe(true);
  });

  it("moves a window's unsaved tabs to recovery before another page's tabs replace them", async () => {
    const factory = new IDBFactory();
    const workspaces = createProjectWorkspaceStore(factory);
    const recovery = createBrowserRecoveryStore({ idbFactory: factory });
    await workspaces.write(
      windowRecord("window", 1, [
        savedTab("edited", alpha, { cloudId: "cloud-alpha", dirty: true }),
        savedTab("clean", beta, { cloudId: "cloud-beta" }),
        savedTab("draft", gamma, { unsafe: true }),
      ]),
    );
    // The address this page opened at found no tabs of its own.
    expect(
      await workspaces.read("window", "/editor?example=bandgap"),
    ).toBeNull();
    // Older copies: the edited tab's own, and the one this page resumes.
    const earlier = [
      { workingCopyId: "working-copy-edited", project: alpha },
      { workingCopyId: "resumed", project: gamma },
    ];
    for (const { workingCopyId, project } of earlier)
      await recovery.writeRecord(
        recoveryRecordOf(
          {
            project,
            session: { workingCopyId, source: "new" },
            unsavedAtSnapshot: true,
            cloudBinding: null,
          },
          `${workingCopyId}-earlier`,
          "2026-10-10T08:00:00.000Z",
        ),
      );

    expect(
      await keepDisplacedTabs(
        workspaces,
        recovery,
        "window",
        "resumed",
        () => "2026-10-10T12:00:00.000Z",
      ),
    ).toEqual({ kept: 2, left: 0 });
    const read = await recovery.readAll();
    // A startup Restore offer still finds the copies it had.
    expect(read.sessions.map(({ workingCopyId }) => workingCopyId)).toEqual(
      expect.arrayContaining(["working-copy-edited", "resumed"]),
    );
    const kept = read.sessions
      .filter(({ latest }) => latest?.updatedAt === "2026-10-10T12:00:00.000Z")
      .map(({ latest }) => latest!)
      .sort((a, b) => a.projectName.localeCompare(b.projectName));
    expect(
      kept.map(
        ({ projectName, projectText, unsavedAtSnapshot, cloudBinding }) => ({
          projectName,
          projectText,
          unsavedAtSnapshot,
          cloudBinding,
        }),
      ),
    ).toEqual([
      {
        projectName: "Alpha",
        projectText: serializeProject(alpha),
        unsavedAtSnapshot: true,
        cloudBinding: { id: "cloud-alpha", revision: 4 },
      },
      {
        projectName: "Gamma",
        projectText: serializeProject(gamma),
        unsavedAtSnapshot: true,
        cloudBinding: undefined,
      },
    ]);
    // Never a working copy the page taking over may resume and overwrite.
    for (const { workingCopyId } of kept)
      expect(workingCopyId).not.toMatch(
        /^(working-copy-edited|working-copy-draft|resumed)$/,
      );

    // Nothing to keep: no saved tabs, or a record nothing can read.
    expect(await keepDisplacedTabs(workspaces, recovery, "other")).toEqual({
      kept: 0,
      left: 0,
    });
    await workspaces.write({
      ...windowRecord("broken", 1, [tab("x")]),
      tabs: [],
    });
    expect(await keepDisplacedTabs(workspaces, recovery, "broken")).toEqual({
      kept: 0,
      left: 0,
    });

    // Recovery storage unavailable: the tabs are left, not lost.
    const unavailable = createBrowserRecoveryStore({
      idbFactory: {
        open: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      } as unknown as IDBFactory,
    });
    expect(await keepDisplacedTabs(workspaces, unavailable, "window")).toEqual({
      kept: 0,
      left: 2,
    });
    workspaces.close();
    recovery.close();
  });

  it("unbinds tabs of Cloud Projects deleted on the account page", () => {
    const record = windowRecord("window", 1, [
      savedTab("deleted", alpha, { cloudId: "cloud-alpha" }),
      savedTab("kept", beta, { cloudId: "cloud-beta" }),
    ]);
    const after = forgetDeletedCloudProjects(record, new Set(["cloud-alpha"]));
    // As the editor's own Shelf Delete leaves it: closing it asks first.
    expect(after.tabs[0]!.session).toMatchObject({
      dirty: true,
      unsafe: true,
      publication: null,
      file: {
        cloudBinding: null,
        savedBaseline: null,
        safeSnapshotToken: null,
        persistenceState: "dirty",
      },
    });
    expect(holdsUnsavedWork(after.tabs[0]!.session)).toBe(true);
    expect(after.tabs[1]).toBe(record.tabs[1]);
    expect(forgetDeletedCloudProjects(record, new Set(["cloud-other"]))).toBe(
      record,
    );
  });
});
