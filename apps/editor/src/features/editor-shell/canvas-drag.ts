const DRAG_THRESHOLD = 5;

/**
 * Dragging a panel row past a few pixels starts placing what it holds; the
 * canvas shows the preview under the pointer and the release ends the
 * placement. A Library component starts asynchronously, so the release may
 * arrive first: the drop then waits for it.
 */
export function startCanvasDrag(
  event: { button: number; clientX: number; clientY: number },
  gesture: {
    begin(): boolean | Promise<boolean>;
    drop(clientX: number, clientY: number): void;
    /** Set while the click that ends a drag arrives, so it does not also act. */
    suppressClick: { current: boolean };
  },
): void {
  if (event.button !== 0) return;
  const origin = { x: event.clientX, y: event.clientY };
  let started: boolean | Promise<boolean> = false;
  function stop() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up, true);
    window.document.body.classList.remove("canvas-dragging");
  }
  function move(moveEvent: PointerEvent) {
    if (
      started ||
      Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) <
        DRAG_THRESHOLD
    )
      return;
    started = gesture.begin();
    if (started) window.document.body.classList.add("canvas-dragging");
    else stop();
  }
  function up(upEvent: PointerEvent) {
    stop();
    if (!started) return;
    gesture.suppressClick.current = true;
    window.setTimeout(() => {
      gesture.suppressClick.current = false;
    }, 0);
    if (started === true) gesture.drop(upEvent.clientX, upEvent.clientY);
    else
      void started.then((ready) => {
        if (ready) gesture.drop(upEvent.clientX, upEvent.clientY);
      });
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, true);
}
