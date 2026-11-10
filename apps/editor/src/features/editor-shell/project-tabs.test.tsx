// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ProjectTabs, type TabSwitchHold } from "./project-tabs";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// jsdom lays nothing out; the strip scrolls its open tab into view.
Element.prototype.scrollIntoView ??= () => {};

/** The actions the strip calls, and its other props apart from its hold. */
function stripActions() {
  return {
    onNew: vi.fn(),
    onSelect: vi.fn(async () => true),
    onClose: vi.fn(),
  };
}
function stripProps(actions: ReturnType<typeof stripActions>) {
  return {
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
  };
}

function clicker(host: HTMLElement) {
  const button = (name: string) =>
    [...host.querySelectorAll("button")].find(
      (candidate) =>
        candidate.getAttribute("aria-label") === name ||
        candidate.textContent === name,
    )!;
  return (name: string) => act(async () => button(name).click());
}

/** Two saved tabs, the first open, with a draft holding it or not. */
async function strip(hold: TabSwitchHold | null) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  let held = hold;
  const actions = stripActions();
  await act(async () =>
    root.render(
      createElement(ProjectTabs, {
        ...stripProps(actions),
        heldBy: () => held,
      }),
    ),
  );
  const click = clicker(host);
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

it("switches tabs on Discard though the hold was read from the render the click came from (#2180)", async () => {
  // As the editor holds it: the draft is state, its hold reads that state,
  // and Discard drops it synchronously.
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  const actions = stripActions();
  function Editor() {
    const [draft, setDraft] = useState(true);
    return createElement(ProjectTabs, {
      ...stripProps(actions),
      heldBy: () =>
        draft
          ? {
              reason: "Document settings hold a draft that is not applied",
              discard: () => flushSync(() => setDraft(false)),
              resume: () => {},
            }
          : null,
    });
  }
  await act(async () => root.render(createElement(Editor)));
  const click = clicker(host);
  await click("B");
  expect(actions.onSelect).not.toHaveBeenCalled();
  await click("Discard draft and continue");
  expect(actions.onSelect).toHaveBeenCalledWith("b");
  expect(
    host.querySelector('[data-testid="project-tab-held-decision"]'),
  ).toBeNull();
  await act(async () => root.unmount());
});
