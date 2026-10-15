/**
 * Puts text on the clipboard. Text still being written goes in at once, as a
 * ClipboardItem holding the promise: Safari lets a click write to the
 * clipboard only while the click is handled, and refuses a write that starts
 * after an await. A browser that takes no promise in a ClipboardItem gets the
 * text once it is ready.
 */
export async function writeClipboardText(
  text: string | Promise<string>,
): Promise<void> {
  if (typeof text === "string") {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof ClipboardItem === "function") {
    const blob = text.then(
      (value) => new Blob([value], { type: "text/plain" }),
    );
    // The browser reads it; a failed text is reported below, not twice.
    blob.catch(() => {});
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/plain": blob }),
      ]);
      return;
    } catch {
      // A failed text is the failure to report; otherwise try plain text.
      await text;
    }
  }
  await navigator.clipboard.writeText(await text);
}
