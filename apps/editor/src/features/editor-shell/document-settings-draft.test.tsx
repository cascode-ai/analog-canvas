// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { expect, it, vi } from "vitest";

import { createEmptyDocument } from "@icm/model";

import { DocumentSettingsSection } from "./document-settings-section";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** The settings panel with its real code editor, and what it reports. */
async function openSettings(
  onApply: () => { ok: true } | { ok: false; message: string } = () => ({
    ok: true,
  }),
) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  const reports: boolean[] = [];
  await act(async () =>
    root.render(
      createElement(DocumentSettingsSection, {
        document: createEmptyDocument("document-main", "Main"),
        canvas: {
          showGrid: true,
          annotationGrid: 5,
          drawAngle: "free",
          scrollBehavior: "auto",
        },
        onApply,
        onDraftChange: (unapplied) => reports.push(unapplied),
      }),
    ),
  );
  await vi.waitFor(() => {
    if (!host.querySelector(".cm-content")) throw new Error("editor loading");
  });
  const view = EditorView.findFromDOM(host.querySelector(".cm-content")!)!;
  const type = (edit: (source: string) => string) =>
    act(async () => {
      const source = view.state.doc.toString();
      view.dispatch({
        changes: { from: 0, to: source.length, insert: edit(source) },
      });
    });
  const close = () => act(async () => root.unmount());
  return { reports, type, close };
}

it("reports no draft for settings merely open (#2180)", async () => {
  const { reports, close } = await openSettings();
  expect(reports).toEqual([false]);
  await close();
  expect(reports.at(-1)).toBe(false);
});

it("reports no draft once a valid setting applied (#2180)", async () => {
  const onApply = vi.fn(() => ({ ok: true }) as const);
  const { reports, type, close } = await openSettings(onApply);
  await type((source) =>
    source.replace('"showGrid": true', '"showGrid": false'),
  );
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(reports.every((unapplied) => !unapplied)).toBe(true);
  await close();
});

it("reports an invalid or refused edit as a draft, and drops it on close (#2180)", async () => {
  const { reports, type, close } = await openSettings(() => ({
    ok: false,
    message: "refused",
  }));
  await type((source) => source.slice(0, -1));
  expect(reports.at(-1)).toBe(true);
  await type((source) => `${source}}`);
  expect(reports.at(-1)).toBe(false);
  await type((source) =>
    source.replace('"showGrid": true', '"showGrid": false'),
  );
  expect(reports.at(-1)).toBe(true);
  await close();
  expect(reports.at(-1)).toBe(false);
});
