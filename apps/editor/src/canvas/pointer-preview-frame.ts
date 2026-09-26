/** Latest-sample scheduling for hover only; clicks and captured drags keep their owners. */
export function createPointerPreviewFrame<T>(
  publish: (sample: T) => void,
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (id: number) => void,
) {
  let pending: { sample: T } | null = null;
  let frame: number | null = null;
  const cancel = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    pending = null;
  };
  const flush = () => {
    const next = pending;
    cancel();
    if (next) publish(next.sample);
  };
  return {
    schedule(sample: T) {
      pending = { sample };
      if (frame === null) frame = requestFrame(flush);
    },
    flush,
    cancel,
  };
}
