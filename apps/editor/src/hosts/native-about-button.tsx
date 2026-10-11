import { useState } from "react";
import { NativeSystemDialog } from "./native-system-dialog";

export function NativeAboutButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="app-action"
        onClick={() => setOpen(true)}
      >
        About
      </button>
      {open ? <NativeSystemDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
