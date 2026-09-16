/** A user-requested focus handoff expires when a newer interaction takes over. */
export function deferFocus(
  target: () => HTMLElement | SVGElement | null,
): () => void {
  const events = ["pointerdown", "keydown", "focusin"] as const;
  const cancel = (): void => {
    window.cancelAnimationFrame(frame);
    for (const event of events) window.removeEventListener(event, cancel, true);
  };
  const frame = window.requestAnimationFrame(() => {
    cancel();
    const element = target();
    if (element?.isConnected && element.getClientRects().length > 0)
      element.focus({ preventScroll: true });
  });
  for (const event of events) window.addEventListener(event, cancel, true);
  return cancel;
}
