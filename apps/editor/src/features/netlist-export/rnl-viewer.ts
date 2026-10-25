import { canvasPackageLock, canvasPackageVersion } from "./rnl-canvas-package";

export const RNL_VIEWER_URL = "https://rich-netlist.github.io/rnl/viewer/";
const viewerOrigin = new URL(RNL_VIEWER_URL).origin;
const requiredFeatures = ["requestId", "packages", "opener"];
const timeoutMs = 60_000;
interface Pending {
  id: string;
  message: Record<string, unknown>;
  sent: boolean;
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
interface Connection {
  popup: Window;
  token: string;
  ready: boolean;
  capabilities: boolean;
  pending: Pending | null;
  receive(event: MessageEvent): void;
}
let connection: Connection | null = null;

function supports(data: { rnl?: unknown; features?: unknown }) {
  const features = data.features;
  return (
    data.rnl === 1 &&
    Array.isArray(features) &&
    requiredFeatures.every((feature) => features.includes(feature))
  );
}

function finish(current: Connection, error?: Error) {
  const pending = current.pending;
  if (!pending) return;
  clearTimeout(pending.timer);
  current.pending = null;
  if (error) pending.reject(error);
  else pending.resolve();
}

function transmit(current: Connection) {
  if (
    current.ready &&
    current.capabilities &&
    current.pending &&
    !current.pending.sent
  ) {
    current.pending.sent = true;
    current.popup.postMessage(current.pending.message, viewerOrigin);
  }
}

/** Called synchronously from the user's click, after the current RNL export is complete. */
export function openRnlViewer(file: {
  name: string;
  text: string;
}): Promise<void> {
  if (!connection || connection.popup.closed) {
    if (connection) window.removeEventListener("message", connection.receive);
    const token = crypto.randomUUID();
    const url = new URL(RNL_VIEWER_URL);
    url.search = new URLSearchParams({
      api: "1",
      origin: location.origin,
      token,
    }).toString();
    // A real opener is needed for the handshake. No await or noopener before this call.
    const popup = window.open(url.href, "rnl-viewer");
    if (!popup)
      return Promise.reject(
        new Error(
          "Allow pop-ups for Analog Canvas, then try Open RNL Viewer again.",
        ),
      );
    const current: Connection = {
      popup,
      token,
      ready: false,
      capabilities: false,
      pending: null,
      receive(event) {
        const data = event.data as Record<string, unknown> | null;
        if (
          event.source !== popup ||
          event.origin !== viewerOrigin ||
          data?.rnl !== 1 ||
          data.token !== token
        )
          return;
        if (data.type === "ready") {
          if (!supports(data)) {
            finish(
              current,
              new Error(
                "This RNL Viewer is too old to import from Analog Canvas. Update the Viewer and retry.",
              ),
            );
            window.removeEventListener("message", current.receive);
            if (connection === current) connection = null;
            return;
          }
          current.ready = true;
          transmit(current);
        } else if (data.requestId === current.pending?.id) {
          if (data.type === "loaded") finish(current);
          else if (data.type === "error")
            finish(
              current,
              new Error(
                typeof data.message === "string"
                  ? data.message
                  : "The Viewer could not import this netlist.",
              ),
            );
        }
      },
    };
    connection = current;
    window.addEventListener("message", current.receive);
    // Older complete Viewers do not emit ready at all: discover support without a timeout.
    void fetch(new URL("viewer-api.json", RNL_VIEWER_URL), {
      cache: "no-cache",
    })
      .then(async (response) => {
        if (response.status === 404)
          throw new Error(
            "This RNL Viewer is too old to import from Analog Canvas. Update the Viewer and retry.",
          );
        if (!response.ok)
          throw new Error(
            `Viewer capabilities could not load (HTTP ${response.status}). Retry Open RNL Viewer.`,
          );
        if (!supports(await response.json()))
          throw new Error(
            "This RNL Viewer is too old to import from Analog Canvas. Update the Viewer and retry.",
          );
        current.capabilities = true;
        transmit(current);
      })
      .catch((error: unknown) => {
        finish(
          current,
          error instanceof Error ? error : new Error(String(error)),
        );
        window.removeEventListener("message", current.receive);
        if (connection === current) connection = null;
      });
  }
  const current = connection;
  current.popup.focus();
  finish(current, new Error("superseded"));
  return new Promise<void>((resolve, reject) => {
    const id = crypto.randomUUID();
    current.pending = {
      id,
      sent: false,
      resolve,
      reject,
      message: {
        rnl: 1,
        type: "open",
        token: current.token,
        requestId: id,
        ...file,
        packages: [
          { name: canvasPackageLock.name, version: canvasPackageVersion },
        ],
      },
      timer: setTimeout(() => {
        finish(
          current,
          new Error(
            current.popup.closed
              ? "The RNL Viewer tab was closed. Try Open RNL Viewer again."
              : "The RNL Viewer did not respond. Check the tab and retry Open RNL Viewer.",
          ),
        );
        if (!current.ready || !current.capabilities) {
          window.removeEventListener("message", current.receive);
          if (connection === current) connection = null;
        }
      }, timeoutMs),
    };
    transmit(current);
  });
}
