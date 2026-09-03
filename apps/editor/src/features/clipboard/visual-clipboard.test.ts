import { createEmptyDocument, semanticTextDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_VISUAL_SELECTION } from "../selection/visual-selection";
import {
  createSelectionClipboardBlob,
  visualClipboardObjectIds,
  writeSelectionClipboard,
} from "./visual-clipboard";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture() {
  const document = createEmptyDocument("main", "Clipboard drawing");
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    placement: { position: { x: 100, y: 100 }, rotation: 90, mirror: "x" },
  });
  document.nets.push({
    id: "supply",
    terminals: [{ instanceId: "R1", pinName: "1" }],
  });
  document.annotations.push(
    {
      id: "name",
      kind: "instance-label",
      content: semanticTextDocument("R1", "instance-label"),
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 900, y: 900 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    },
    {
      id: "distant",
      kind: "net-label",
      netId: "supply",
      binding: { kind: "net-name", netId: "supply" },
      anchor: { kind: "free", position: { x: 900, y: 900 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    },
  );
  return {
    document,
    selection: { ...EMPTY_VISUAL_SELECTION, instanceIds: ["R1"] },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("visual clipboard", () => {
  it("includes owned labels but never grows through a Net or touches the Document", async () => {
    const { document, selection } = fixture();
    const before = structuredClone(document);
    expect([...visualClipboardObjectIds(document, selection)]).toEqual([
      "R1",
      "name",
    ]);
    const blob = await createSelectionClipboardBlob(
      "svg",
      document,
      selection,
      resolver,
    );
    const svg = await blob.text();
    expect(blob.type).toBe("image/svg+xml");
    expect(svg).toContain('data-object-id="name"');
    expect(svg).toContain("rotate(90)");
    expect(svg).not.toContain('data-object-id="distant"');
    expect(svg).not.toMatch(/editor-overlay|hit-target|flightline/);
    expect(svg).not.toMatch(/<rect[^>]+fill="#fff/);
    expect(document).toEqual(before);
  });

  it("copies a label alone using its unselected owner's real anchor", async () => {
    const { document } = fixture();
    const svg = await (
      await createSelectionClipboardBlob(
        "svg",
        document,
        {
          ...EMPTY_VISUAL_SELECTION,
          annotationIds: ["name"],
        },
        resolver,
      )
    ).text();
    expect(svg).toContain('data-object-id="name"');
    expect(svg).not.toContain('data-object-id="R1"');
    const viewBox = /viewBox="([^"]+)"/u.exec(svg)![1]!.split(" ").map(Number);
    expect(viewBox[0]).toBeLessThan(200);
    expect(viewBox[1]).toBeLessThan(200);
  });

  it("does not copy the whole drawing for an empty or stale selection", async () => {
    const { document } = fixture();
    await expect(
      createSelectionClipboardBlob(
        "svg",
        document,
        EMPTY_VISUAL_SELECTION,
        resolver,
      ),
    ).rejects.toThrow("Select visible");
    await expect(
      createSelectionClipboardBlob(
        "svg",
        document,
        { ...EMPTY_VISUAL_SELECTION, instanceIds: ["deleted"] },
        resolver,
      ),
    ).rejects.toThrow("Select visible");
  });

  it("writes during the gesture and captures the revision before asynchronous preparation", async () => {
    const { document, selection } = fixture();
    let item: { data: Record<string, Promise<Blob>> } | undefined;
    const write = vi.fn((items: { data: Record<string, Promise<Blob>> }[]) => {
      item = items[0];
      return item!.data["image/svg+xml"]!.then(() => {});
    });
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        static supports() {
          return true;
        }
        constructor(public data: Record<string, Promise<Blob>>) {}
      },
    );
    const result = writeSelectionClipboard(
      "svg",
      document,
      selection,
      resolver,
    );
    expect(write).toHaveBeenCalledTimes(1);
    document.instances = [];
    selection.instanceIds.length = 0;
    await result;
    const svg = await (await item!.data["image/svg+xml"]!).text();
    expect(svg).toContain('data-object-id="R1"');
    expect(Object.keys(item!.data)).toEqual(["image/svg+xml"]);
  });

  it("rejects unavailable MIME and permission failures without downloading or reporting a different format", async () => {
    const { document, selection } = fixture();
    const write = vi.fn();
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        static supports() {
          return false;
        }
      },
    );
    await expect(
      writeSelectionClipboard("svg", document, selection, resolver),
    ).rejects.toThrow("Try Copy as PNG");
    expect(write).not.toHaveBeenCalled();
    vi.stubGlobal(
      "ClipboardItem",
      class {
        static supports() {
          return true;
        }
      },
    );
    write.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    await expect(
      writeSelectionClipboard("svg", document, selection, resolver),
    ).rejects.toMatchObject({ name: "NotAllowedError" });
    vi.stubGlobal("isSecureContext", false);
    await expect(
      writeSelectionClipboard("png", document, selection, resolver),
    ).rejects.toThrow("HTTPS or localhost");
  });
});
