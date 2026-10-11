import { useEffect, useState } from "react";
import { NativeLibraryDialog } from "./native-library-dialog";

export interface NativeProjectHomeProps {
  initiallyOpen: boolean;
  onOpen(id?: string): void;
  onNew(): void;
}

/** The desktop's project landing page also stays reachable from its header. */
export function NativeProjectHome({
  initiallyOpen,
  onOpen,
  onNew,
}: NativeProjectHomeProps) {
  const [open, setOpen] = useState(initiallyOpen);
  useEffect(() => {
    const opened = () => setOpen(false);
    window.addEventListener("analog-canvas-native-open", opened);
    return () =>
      window.removeEventListener("analog-canvas-native-open", opened);
  }, []);
  return (
    <>
      <button
        type="button"
        className="app-action"
        onClick={() => setOpen(true)}
      >
        Local projects
      </button>
      {open ? (
        <NativeLibraryDialog
          onClose={() => setOpen(false)}
          onOpen={onOpen}
          onNew={onNew}
        />
      ) : null}
    </>
  );
}
