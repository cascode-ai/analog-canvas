// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { usePowerPointSave } from "./powerpoint-save";

// The slide picture is measured by the browser's SVG layout, which jsdom
// does not have; the packaged desktop acceptance saves the real one.
vi.mock("../features/editor-shell/editor-export-commands", () => ({
  createSvgExportArtifact: async () => ({ bytes: "<svg/>" }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// jsdom's Blob reads only through FileReader.
Blob.prototype.text ??= function (this: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(this);
  });
};

let root: Root | undefined;
let host: HTMLDivElement;
/** The desktop host's PowerPoint exchange: the link, then each receipt. */
let ack: { sequence: number; ok: boolean; error?: string } | undefined;
let posted: { token: string; documentId: string }[];

function drawing(id = "linked"): CircuitProject {
  const project = createEmptyProject(id, id, "main");
  project.documents[0]!.instances.push({
    id: "r1",
    reference: "R1",
    symbolId: "resistor",
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
  });
  return project;
}

const linked = drawing();

function Editor({ project }: { project: CircuitProject }) {
  const { action, notice } = usePowerPointSave({
    project,
    document: project.documents[0]!,
    blocker: () => null,
    capture: async () => project,
    openDocument: () => {},
    readProject: (id) =>
      id === project.id
        ? {
            tabId: "tab",
            project,
            documentId: project.documents[0]!.id,
          }
        : null,
  });
  return createElement("div", null, action, notice);
}

async function show(project: CircuitProject) {
  await act(async () => {
    root ??= createRoot(host);
    root.render(createElement(Editor, { project }));
  });
  // The link arrives from the host after the first render.
  await act(async () => {});
}

const button = () =>
  host.querySelector<HTMLButtonElement>('[data-testid="powerpoint-save"]')!;
/** The word the button shows; the other only holds its width. */
const label = () =>
  button().querySelector('.powerpoint-save-label > [aria-hidden="false"]')
    ?.textContent;
const notice = () =>
  host.querySelector<HTMLElement>('[data-testid="powerpoint-notice"]');

beforeEach(() => {
  vi.stubEnv("ICM_DESKTOP", "1");
  host = document.createElement("div");
  document.body.append(host);
  ack = undefined;
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ sequence: 1 }));
      }
      return new Response(
        JSON.stringify({
          enabled: true,
          token: "session",
          projectId: linked.id,
          documentId: linked.documents[0]!.id,
          ack,
        }),
      );
    }),
  );
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("puts one button in the header, its dot following the slide", async () => {
  await show(linked);
  expect(button().getAttribute("aria-label")).toBe("Save to PowerPoint");
  expect(label()).toBe("PowerPoint");
  // The slide shows the drawing it opened.
  expect(button().dataset.state).toBe("saved");
  // Nothing floats over the canvas until there is an outcome to say.
  expect(notice()).toBeNull();

  const edited = structuredClone(linked);
  edited.documents[0]!.instances[0]!.reference = "R2";
  await show(edited);
  expect(button().dataset.state).toBe("unsaved");

  // Undo back to what the slide shows.
  await show(structuredClone(linked));
  expect(button().dataset.state).toBe("saved");
});

it("greys on another tab and says, when clicked, where to go", async () => {
  await show(drawing("other"));
  expect(button().dataset.state).toBe("elsewhere");
  expect(button().getAttribute("aria-disabled")).toBe("true");
  expect(button().title).toBe("Return to the linked PowerPoint project tab.");
  await act(async () => button().click());
  expect(posted).toEqual([]);
  expect(notice()?.textContent).toContain(
    "Return to the linked PowerPoint project tab.",
  );
});

it("saves to the slide, says so briefly, then fades", async () => {
  await show(linked);
  const edited = structuredClone(linked);
  edited.documents[0]!.instances[0]!.reference = "R2";
  await show(edited);
  expect(button().dataset.state).toBe("unsaved");
  vi.useFakeTimers();
  ack = { sequence: 1, ok: true };
  await act(async () => button().click());
  expect(label()).toBe("Saving…");
  expect(button().disabled).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(posted).toEqual([
    expect.objectContaining({
      token: "session",
      documentId: linked.documents[0]!.id,
    }),
  ]);
  expect(notice()?.querySelector('[role="status"]')?.textContent).toBe(
    "Drawing updated. Save your presentation in PowerPoint.",
  );
  expect(button().dataset.state).toBe("saved");
  expect(label()).toBe("PowerPoint");
  await act(async () => vi.advanceTimersByTimeAsync(4_000));
  expect(notice()).toBeNull();
});

it("keeps a refused save amber and says why for longer", async () => {
  await show(linked);
  const edited = structuredClone(linked);
  edited.documents[0]!.instances[0]!.reference = "R2";
  await show(edited);
  expect(button().dataset.state).toBe("unsaved");
  vi.useFakeTimers();
  ack = { sequence: 1, ok: false, error: "PPT unavailable" };
  await act(async () => button().click());
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(notice()?.dataset.failed).toBe("true");
  expect(notice()?.textContent).toContain("PPT unavailable");
  expect(button().dataset.state).toBe("unsaved");
  await act(async () => vi.advanceTimersByTimeAsync(4_000));
  expect(notice()).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(4_000));
  expect(notice()).toBeNull();
});

it("asks at close exactly when the dot is amber", async () => {
  // The desktop host's own close state: nothing of its own to save.
  vi.stubGlobal("__analogCanvasDesktop", {
    state: () => ({ dirty: [], busy: false, pendingEdits: false }),
    save: async () => ({ status: "saved" }),
  });
  const closing = () =>
    (
      window as unknown as {
        __circuitPowerPoint: { state(): { dirty: unknown[] } };
      }
    ).__circuitPowerPoint.state().dirty;
  await show(linked);
  expect(button().dataset.state).toBe("saved");
  expect(closing()).toEqual([]);
  const edited = structuredClone(linked);
  edited.documents[0]!.instances[0]!.reference = "R2";
  await show(edited);
  expect(button().dataset.state).toBe("unsaved");
  expect(closing()).toEqual([{ id: "tab", name: "linked" }]);
});
