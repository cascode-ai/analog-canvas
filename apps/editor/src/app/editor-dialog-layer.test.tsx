// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import {
  EditorDialogLayer,
  type EditorDialogLayerProps,
} from "./editor-dialog-layer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  vi.unstubAllGlobals();
  window.document.body.replaceChildren();
  window.document.head.replaceChildren();
});

it("stands every notice in one column under the chrome (#2182)", async () => {
  // The page booted from one entry; the editor's address now serves another.
  const entry = window.document.createElement("script");
  entry.type = "module";
  entry.src = "/assets/index-old.js";
  window.document.head.append(entry);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          '<script type="module" crossorigin src="/assets/index-new.js"></script>',
        ),
    ),
  );
  Object.defineProperty(window.document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  // jsdom lays nothing out: the chrome ends at the issue's y = 112.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const chrome = window.document.createElement("header");
  chrome.className = "app-chrome";
  chrome.getBoundingClientRect = () => ({ bottom: 112 }) as DOMRect;
  window.document.body.append(chrome);

  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  const none = () => {};
  const layer: EditorDialogLayerProps = {
    notices: createElement("aside", { "data-testid": "powerpoint-notice" }),
    chunkLoadFailure: { feature: "Export", onDismiss: none },
    recoveryFailure: { state: "failed", onDownload: none, onDismiss: none },
    recoveryAvailable: null,
    workspaceReopen: {
      names: ["Two-stage op-amp"],
      savedAt: Date.UTC(2026, 10, 10),
      onReopen: none,
      onDismiss: none,
    },
    recentRecovery: null,
    replaceGuard: null,
    saveSignIn: null,
    search: null,
    insertComponent: null,
    cellManager: null,
    cellProperties: null,
    importCell: null,
    netlistPreflight: null,
    publishGallery: null,
    versionHistory: null,
    agentConnection: null,
    agentFileApproval: null,
  };
  await act(async () => root.render(createElement(EditorDialogLayer, layer)));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });

  const column = host.querySelector<HTMLElement>(
    '[data-testid="editor-notices"]',
  )!;
  expect(
    [...column.children].map((notice) => notice.getAttribute("data-testid")),
  ).toEqual([
    "powerpoint-notice",
    "chunk-load-banner",
    "new-deploy-banner",
    "recovery-failure-banner",
    "workspace-reopen-banner",
  ]);
  // No notice places itself: the column does, 8 px under the chrome.
  expect(column.style.getPropertyValue("--editor-notices-top")).toBe("120px");
  for (const notice of column.children)
    expect((notice as HTMLElement).style.top).toBe("");
  await act(async () => root.unmount());
});
