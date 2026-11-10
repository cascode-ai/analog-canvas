// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ProjectTabs, type TabSwitchHold } from "./project-tabs";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// jsdom lays nothing out; the strip scrolls its open tab into view.
Element.prototype.scrollIntoView ??= () => {};

/** Two saved tabs, the first open, with a draft holding it or not. */
async function strip(hold: TabSwitchHold | null) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  let held = hold;
  const actions = {
    onNew: vi.fn(),
    onSelect: vi.fn(async () => true),
    onClose: vi.fn(),
  };
  await act(async () =>
    root.render(
      createElement(ProjectTabs, {
        tabs: [
          { id: "a", name: "A", dirty: false },
          { id: "b", name: "B", dirty: false },
        ],
        activeId: "a",
        busy: false,
        ...actions,
        onRename: vi.fn(),
        onEditingChange: vi.fn(),
        onCloseMany: vi.fn(),
        onOpenFile: vi.fn(),
        cloudProjects: [],
        onShelfOpened: vi.fn(),
        onOpenShelf: vi.fn(),
        onRenameShelf: vi.fn(async () => {}),
        onDeleteShelf: vi.fn(async () => {}),
        heldBy: () => held,
      }),
    ),
  );
  const button = (name: string) =>
    [...host.querySelectorAll("button")].find(
      (candidate) =>
        candidate.getAttribute("aria-label") === name ||
        candidate.textContent === name,
    )!;
  const click = (name: string) => act(async () => button(name).click());
  const decision = () =>
    host.querySelector('[data-testid="project-tab-held-decision"]');
  return {
    actions,
    click,
    decision,
    release: () => (held = null),
    unmount: () => act(async () => root.unmount()),
  };
}

it("changes tabs at once when nothing holds the Project (#2180)", async () => {
  const { actions, click, decision, unmount } = await strip(null);
  await click("New project tab");
  await click("B");
  expect(actions.onNew).toHaveBeenCalledTimes(1);
  expect(actions.onSelect).toHaveBeenCalledWith("b");
  expect(decision()).toBeNull();
  await unmount();
});

it("asks beside the strip before a draft is dropped for a new tab (#2180)", async () => {
  const hold = {
    reason: "Document settings hold a draft that is not applied",
    discard: vi.fn(),
    resume: vi.fn(),
  };
  const { actions, click, decision, release, unmount } = await strip(hold);
  await click("New project tab");
  expect(actions.onNew).not.toHaveBeenCalled();
  expect(decision()?.textContent).toContain(
    "Document settings hold a draft that is not applied.",
  );

  await click("Keep editing");
  expect(hold.resume).toHaveBeenCalledTimes(1);
  expect(decision()).toBeNull();
  expect(actions.onNew).not.toHaveBeenCalled();

  await click("New project tab");
  hold.discard.mockImplementation(release);
  await click("Discard draft and continue");
  expect(hold.discard).toHaveBeenCalledTimes(1);
  expect(actions.onNew).toHaveBeenCalledTimes(1);
  expect(decision()).toBeNull();
  await unmount();
});

it("asks before switching or closing the open tab, not another (#2180)", async () => {
  const hold = { reason: "Held", discard: vi.fn(), resume: vi.fn() };
  const { actions, click, decision, release, unmount } = await strip(hold);
  await click("Close tab B");
  expect(actions.onClose).toHaveBeenCalledWith("b");
  expect(decision()).toBeNull();

  await click("Close tab A");
  expect(actions.onClose).not.toHaveBeenCalledWith("a");
  expect(decision()).not.toBeNull();

  await click("B");
  expect(actions.onSelect).not.toHaveBeenCalled();
  hold.discard.mockImplementation(release);
  await click("Discard draft and continue");
  expect(actions.onSelect).toHaveBeenCalledWith("b");
  await unmount();
});
