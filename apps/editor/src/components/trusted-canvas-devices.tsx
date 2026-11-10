import { useState } from "react";
import { DEVICE_TRUST_PATH } from "@icm/agent-adapter/browser-launch";

type Device = {
  id: string;
  /** What the installation calls itself, when it said. */
  name?: string;
  trustedAt: number;
  /** When it last opened a task. */
  lastUsedAt?: number;
};

const day = (time: number) => new Date(time).toLocaleDateString();

export function TrustedCanvasDevices() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function load() {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(DEVICE_TRUST_PATH, {
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) throw Error();
      setDevices(((await response.json()) as { devices: Device[] }).devices);
    } catch {
      setStatus("Could not read trusted devices. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`${DEVICE_TRUST_PATH}/${id}`, {
        method: "DELETE",
        redirect: "error",
      });
      if (!response.ok) throw Error();
      setDevices(
        (current) => current?.filter((device) => device.id !== id) ?? [],
      );
      setStatus("Device access revoked.");
    } catch {
      setStatus("Could not revoke device access. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="account-page-section"
      aria-labelledby="trusted-canvas-devices"
    >
      <h3 id="trusted-canvas-devices">Trusted Canvas devices</h3>
      <p className="account-page-note">
        A trusted installation can open new Agent review tabs for this account.
        Revoking it also ends its trusted tasks.
      </p>
      <button type="button" disabled={busy} onClick={() => void load()}>
        {devices ? "Refresh trusted devices" : "Show trusted devices"}
      </button>
      {devices?.length === 0 ? <p>No trusted devices on this site.</p> : null}
      {devices?.map(({ id, name, trustedAt, lastUsedAt }) => (
        <div className="account-page-row" key={id}>
          <div>
            <span className="account-page-label">
              {name ?? `Device ${id.slice(0, 8)}`}
            </span>
            <span className="account-page-value">
              Trusted {day(trustedAt)}
              {lastUsedAt ? ` · last used ${day(lastUsedAt)}` : ""}
            </span>
          </div>
          <button type="button" disabled={busy} onClick={() => void revoke(id)}>
            Revoke device
          </button>
        </div>
      ))}
      {status ? <p role="status">{status}</p> : null}
    </section>
  );
}
