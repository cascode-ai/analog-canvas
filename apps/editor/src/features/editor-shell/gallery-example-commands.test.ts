import {
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
} from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { describe, expect, it, vi } from "vitest";

import { createGalleryExampleCommands } from "./gallery-example-commands";

const defaultViewBox = { x: 0, y: 0, width: 960, height: 640 };

function dependencies(fetchImpl: typeof fetch = vi.fn<typeof fetch>()) {
  return {
    defaultViewBox,
    replaceActiveProject: vi.fn(),
    guardDirtyReplacement: vi.fn(async (_intent, perform) => {
      await perform();
    }),
    beginCopyPlacement: vi.fn(),
    cancelAllTransientInteraction: vi.fn(),
    setGalleryEntryContext: vi.fn(),
    setStatus: vi.fn(),
    fetchImpl,
  };
}

describe("Gallery and example commands", () => {
  it("starts a whole-Document placement with interface composition policy", () => {
    const input = dependencies();
    const imported = createEmptyProject("imported", "Imported");
    imported.documents[0]!.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 80 },
        rotation: 0,
        mirror: "none",
      },
    });
    const commands = createGalleryExampleCommands(input);

    expect(commands.beginProjectImportPlacement(imported, "Scene")).toBe(true);

    expect(input.cancelAllTransientInteraction).toHaveBeenCalledOnce();
    expect(input.beginCopyPlacement).toHaveBeenCalledWith(
      expect.objectContaining({ instances: imported.documents[0]!.instances }),
      { x: 100, y: 80 },
    );
    expect(input.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("Place Scene on the canvas"),
    );
  });

  it("normalizes a switch Route collapsed by current pins before Gallery placement", () => {
    const input = dependencies();
    const imported = createEmptyProject("legacy-switch", "Legacy switch");
    const document = imported.documents[0]!;
    document.instances.push(
      {
        id: "X1",
        symbolId: "ideal-switch",
        placement: {
          position: { x: 500, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "P1",
        symbolId: "port",
        placement: {
          position: { x: 510, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-contact",
      terminals: [
        { instanceId: "X1", pinName: "2" },
        { instanceId: "P1", pinName: "P" },
      ],
    });
    document.netlist!.terminals.push({
      id: "terminal-p1",
      name: "OUT",
      netId: "net-contact",
      direction: "passive",
      interfaceInstanceIds: ["P1"],
    });
    document.routes.push(
      createRoutePath({
        id: "legacy-ten-unit-route",
        netId: "net-contact",
        start: { kind: "terminal", instanceId: "P1", pinName: "P" },
        end: { kind: "terminal", instanceId: "X1", pinName: "2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const commands = createGalleryExampleCommands(input);

    expect(commands.beginProjectImportPlacement(imported, "Switch")).toBe(true);

    expect(input.beginCopyPlacement).toHaveBeenCalledWith(
      expect.objectContaining({
        routes: [],
        nets: [
          expect.objectContaining({
            terminals: expect.arrayContaining([
              { instanceId: "X1", pinName: "2" },
              { instanceId: "P1", pinName: "P" },
            ]),
          }),
        ],
      }),
      { x: 500, y: 200 },
    );
    expect(document.routes).toHaveLength(1);
  });

  it("leaves hierarchical Projects for guarded replacement", () => {
    const input = dependencies();
    const imported = createEmptyProject("imported", "Imported");
    imported.documents.push(createEmptyDocument("child", "Child"));
    const commands = createGalleryExampleCommands(input);

    expect(commands.beginProjectImportPlacement(imported, "Hierarchy")).toBe(
      false,
    );
    expect(input.beginCopyPlacement).not.toHaveBeenCalled();
  });

  it("starts placement for a drawing-only Gallery Project", () => {
    const input = dependencies();
    const imported = createEmptyProject("imported", "Drawing");
    imported.documents[0]!.drafting = {
      objects: [
        {
          id: "gallery-rectangle",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 60, y: 40 } },
          center: { x: 60, y: 40 },
          width: 80,
          height: 40,
          rotation: 0,
          lineStyle: "solid",
        },
      ],
    };
    const commands = createGalleryExampleCommands(input);

    expect(commands.beginProjectImportPlacement(imported, "Drawing")).toBe(
      true,
    );
    expect(input.beginCopyPlacement).toHaveBeenCalledWith(
      expect.objectContaining({
        draftingObjects: imported.documents[0]!.drafting.objects,
      }),
      { x: 60, y: 40 },
    );
    expect(input.replaceActiveProject).not.toHaveBeenCalled();
  });

  it("opens a Gallery Project and records the live entry context", async () => {
    const project = createEmptyProject("gallery-project", "Project fallback");
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        entry: {
          name: "Published name",
          author: "Ada",
          description: "A circuit",
          tags: ["ota"],
        },
        ownerUserId: "user-1",
        projectText: serializeProject(project),
      }),
    );
    const input = dependencies(fetchImpl);
    const commands = createGalleryExampleCommands(input);

    await commands.openGalleryEntryById("entry-1");

    expect(input.guardDirtyReplacement).toHaveBeenCalledWith(
      "Open gallery circuit Published name",
      expect.any(Function),
    );
    expect(input.replaceActiveProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gallery-project" }),
      defaultViewBox,
    );
    expect(input.setGalleryEntryContext).toHaveBeenCalledWith({
      id: "entry-1",
      name: "Published name",
      projectId: "gallery-project",
      ownerUserId: "user-1",
      author: "Ada",
      description: "A circuit",
      tags: ["ota"],
    });
  });

  it("reports unavailable Gallery payloads without replacing the Project", async () => {
    const input = dependencies(
      vi.fn<typeof fetch>(async () => Response.json({}, { status: 404 })),
    );
    const commands = createGalleryExampleCommands(input);

    await commands.openGalleryEntryById("missing");

    expect(input.replaceActiveProject).not.toHaveBeenCalled();
    expect(input.setStatus).toHaveBeenCalledWith(
      "This gallery entry is unavailable",
    );
  });
});
