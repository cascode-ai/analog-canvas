import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  createProjectWorkspaceStore,
  type ProjectWorkspace,
} from "./project-workspace";
import {
  findWorkspaceReopenOffer,
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
function windowRecord(
  windowId: string,
  savedAt: number,
  tabs: ReturnType<typeof tab>[],
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
