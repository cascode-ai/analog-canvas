import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboardText } from "./clipboard-text";

class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob>>) {}
}

function clipboard({ writeFails = false } = {}) {
  const writeText = vi.fn(async (_text: string) => {});
  const write = vi.fn(async (items: FakeClipboardItem[]) => {
    if (writeFails) throw new TypeError("No promise in a ClipboardItem");
    await items[0]!.items["text/plain"];
  });
  vi.stubGlobal("navigator", { clipboard: { writeText, write } });
  return { writeText, write };
}

afterEach(() => vi.unstubAllGlobals());

describe("clipboard text", () => {
  it("writes ready text as plain text", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const { writeText, write } = clipboard();
    await writeClipboardText("* netlist");
    expect(writeText).toHaveBeenCalledWith("* netlist");
    expect(write).not.toHaveBeenCalled();
  });

  it("starts the write at once for text still being written", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const { writeText, write } = clipboard();
    const text = Promise.withResolvers<string>();
    const copied = writeClipboardText(text.promise);
    expect(write).toHaveBeenCalledOnce();
    text.resolve("* written");
    await copied;
    const item = write.mock.calls[0]![0][0]!;
    expect(await (await item.items["text/plain"]!).text()).toBe("* written");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("writes the text when it is ready where a ClipboardItem takes no promise", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const { writeText } = clipboard({ writeFails: true });
    await writeClipboardText(Promise.resolve("* written"));
    expect(writeText).toHaveBeenCalledWith("* written");
  });

  it("waits for the text without ClipboardItem", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    const { writeText, write } = clipboard();
    await writeClipboardText(Promise.resolve("* written"));
    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("* written");
  });

  it("fails with the text's own failure and writes nothing", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const { writeText } = clipboard();
    await expect(
      writeClipboardText(Promise.reject(new Error("no runtime"))),
    ).rejects.toThrow("no runtime");
    expect(writeText).not.toHaveBeenCalled();
  });
});
