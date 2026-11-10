/** The loopback connector hands off a fresh tab through this same-site route. */
export const BROWSER_LAUNCH_PATH = "/api/agent/editor-launch";
export const BROWSER_LAUNCH_PENDING_PROJECT = "agent-launch-pending";
export const BROWSER_LAUNCH_GRANT_PREFIX = "launch-";
export const BROWSER_LAUNCH_TTL_MS = 90_000;
export const DEVICE_TRUST_PATH = "/api/agent/trusted-devices";

export interface BrowserLaunchDeviceProof {
  publicKey: string;
  signature: string;
  /** How the approval page and Settings name the installation; unsigned. */
  name?: string;
}

export function browserLaunchProofText(
  origin: string,
  sessionId: string,
  grant: string,
) {
  return JSON.stringify([
    "analog-canvas-device-launch-v1",
    origin,
    sessionId,
    grant,
  ]);
}
