import { createPublicKey, verify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserLaunchProofText } from "@icm/agent-adapter/browser-launch";
import { expect, it } from "vitest";
import { browserDeviceProof } from "./browser-device.js";

it("reuses the installation key when launch proofs race and binds each signature to its launch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canvas-device-test-"));
  try {
    const path = join(directory, "connector.device.pem");
    const origin = "https://editor.example";
    const launch = { sessionId: "first", launchGrant: "grant-one" };
    const next = { sessionId: "second", launchGrant: "grant-two" };
    const [first, second] = await Promise.all([
      browserDeviceProof(path, origin, launch),
      browserDeviceProof(path, origin, next),
    ]);
    expect(second.publicKey).toBe(first.publicKey);
    const publicKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: first.publicKey },
      format: "jwk",
    });
    const signature = Buffer.from(first.signature, "base64url");
    const message = (candidate: typeof launch) =>
      Buffer.from(
        browserLaunchProofText(
          origin,
          candidate.sessionId,
          candidate.launchGrant,
        ),
      );
    expect(verify(null, message(launch), publicKey, signature)).toBe(true);
    expect(verify(null, message(next), publicKey, signature)).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
