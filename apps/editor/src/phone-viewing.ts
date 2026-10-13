/**
 * Phones browse the Gallery and view a circuit; drawing needs a computer or
 * a tablet (2026-10-14). A phone is a narrow screen with a coarse pointer.
 * Someone who still wants the editor opens it for this tab. No imports: the
 * page entry and the build's preload script read this module.
 */
export const PHONE_QUERY = "(max-width: 700px) and (pointer: coarse)";
export const PHONE_EDITOR_KEY = "icm.phone-editor";

export function isPhoneViewing(
  win: Pick<Window, "matchMedia" | "sessionStorage"> = window,
): boolean {
  try {
    if (win.sessionStorage.getItem(PHONE_EDITOR_KEY) === "1") return false;
  } catch {
    // Without storage the choice simply is not remembered.
  }
  return typeof win.matchMedia === "function"
    ? win.matchMedia(PHONE_QUERY).matches
    : false;
}

/** Opens the editor on this phone anyway, for this tab. */
export function openEditorOnPhone(
  win: Pick<Window, "sessionStorage" | "location"> = window,
): void {
  try {
    win.sessionStorage.setItem(PHONE_EDITOR_KEY, "1");
  } catch {
    // The reload below still shows the page; it simply asks again later.
  }
  win.location.reload();
}
