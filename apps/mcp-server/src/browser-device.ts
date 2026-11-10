import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import {
  browserLaunchProofText,
  type BrowserLaunchDeviceProof,
} from "@icm/agent-adapter/browser-launch";

const SYSTEMS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

async function loadDeviceKey(path: string) {
  try {
    return createPrivateKey(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const { privateKey } = generateKeyPairSync("ed25519");
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      privateKey.export({ format: "pem", type: "pkcs8" }),
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    // The winning process publishes one complete key. The other processes
    // sign with that key without replacing it.
    try {
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return createPrivateKey(await readFile(path));
    }
    return privateKey;
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function browserDeviceProof(
  keyPath: string,
  origin: string,
  launch: { sessionId: string; launchGrant: string },
): Promise<BrowserLaunchDeviceProof> {
  const key = await loadDeviceKey(keyPath);
  if (key.asymmetricKeyType !== "ed25519")
    throw Error("Canvas device key must be Ed25519");
  const publicKey = createPublicKey(key).export({ format: "jwk" }).x!;
  const message = browserLaunchProofText(
    origin,
    launch.sessionId,
    launch.launchGrant,
  );
  const system = SYSTEMS[process.platform] ?? process.platform;
  return {
    publicKey,
    signature: sign(null, Buffer.from(message), key).toString("base64url"),
    name: `${hostname()} (${system})`,
  };
}
