import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { z } from "zod";
import { nativePathLabel } from "./native-path-label";
import "./native-dialog.css";

const infoSchema = z.object({
  version: z.string(),
  commit: z.string(),
  dirty: z.boolean(),
  format: z.number(),
  userData: z.string(),
  projectRoot: z.string(),
  packaged: z.boolean(),
  migration: z.string(),
  association: z.object({
    enabled: z.boolean(),
    otherInstallation: z.boolean(),
  }),
});
let pending: Promise<unknown> = Promise.resolve();
function systemRequest(action: string) {
  const result = pending.then(() => request(action));
  pending = result.catch(() => {});
  return result;
}
async function request(action: string) {
  const response = await fetch(`/desktop/system/${action}`, { method: "POST" });
  const value: unknown = await response.json();
  const envelope = z
    .object({
      status: z.string(),
      message: z.string().optional(),
      info: z.unknown().optional(),
    })
    .parse(value);
  if (!response.ok || envelope.status !== "ready")
    throw new Error(envelope.message ?? "Desktop settings unavailable");
  return envelope;
}
export function NativeSystemDialog({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [info, setInfo] = useState<z.infer<typeof infoSchema> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () =>
    setInfo(infoSchema.parse((await systemRequest("info")).info));
  useEffect(() => {
    dialog.current?.showModal();
    void refresh().catch((error) => setError(String(error)));
  }, []);
  async function change(action: "enable" | "disable") {
    setBusy(true);
    setError("");
    try {
      await systemRequest(action);
      await refresh();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="native-dialog native-save-dialog"
      aria-label="About Analog Canvas"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <h2>About Analog Canvas</h2>
        <button disabled={busy} onClick={onClose}>
          Close
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {info ? (
        <>
          <p>
            Version {info.version} · Source {info.commit.slice(0, 12)}
            {info.dirty ? " (uncommitted development build)" : ""} · Project
            format {info.format}
          </p>
          <p>
            <code>
              https://github.com/cascode-ai/analog-canvas/commit/{info.commit}
            </code>
          </p>
          <p title={info.projectRoot}>
            Projects: {nativePathLabel(info.projectRoot)}
          </p>
          <p title={info.userData}>
            Application data: {nativePathLabel(info.userData)}
          </p>
          <p>{info.migration}</p>
          <h3>Windows file opening</h3>
          <p>
            Enable opening .icproj files with this installation. These files
            contain the same project JSON. Existing .icproj.json files still
            open through File → Open Project. Other JSON files keep their
            current application.
          </p>
          <p>
            {info.association.enabled
              ? "Enabled for this installation."
              : info.association.otherInstallation
                ? "Registered to a different installation. Enable here after an upgrade to use this copy."
                : "Not enabled for this installation."}
          </p>
          <button
            disabled={busy || !info.packaged}
            onClick={() => void change("enable")}
          >
            Enable file association…
          </button>{" "}
          <button
            disabled={busy || !info.packaged || !info.association.enabled}
            onClick={() => void change("disable")}
          >
            Remove file association…
          </button>
          {!info.packaged ? (
            <p>File association is available in the packaged application.</p>
          ) : null}
        </>
      ) : (
        <p>Reading application information…</p>
      )}
    </dialog>,
    document.body,
  );
}
