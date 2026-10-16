import { useLayoutEffect, useRef, useState } from "react";
import { ComponentPopover } from "./component-popover";
/** Kept beside the clicked exit; showing it never moves the user's focus. */
export function ComponentLeaveConfirmation({
  onSave,
  onDiscard,
  onKeepEditing,
}: {
  onSave(): void;
  onDiscard(): void;
  onKeepEditing(): void;
}) {
  const marker = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setAnchor(
      marker.current?.parentElement?.querySelector<HTMLElement>(
        "button,select",
      ) ?? null,
    );
  }, []);
  return (
    <>
      <span ref={marker} hidden />
      {anchor ? (
        <ComponentPopover
          anchor={anchor}
          label="Leave component editor"
          onClose={onKeepEditing}
        >
          <button type="button" onClick={onSave}>
            Save draft &amp; leave
          </button>
          <button type="button" onClick={onDiscard}>
            Discard changes
          </button>
          <button type="button" onClick={onKeepEditing}>
            Keep editing
          </button>
        </ComponentPopover>
      ) : null}
    </>
  );
}
