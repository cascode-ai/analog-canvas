import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

/** Persistent M4 pairing record. Short-lived Circuit bearers are never stored. */
export interface StoredConnectorCredential {
  version: 1;
  apiBaseUrl: string;
  sessionId: string;
  connectorToken: string;
  connectorExpiresAt: number;
  storedAt: number;
}

export const CONNECTOR_FILE_VERSION = 1;

export class ConnectorStore {
  constructor(readonly path: string) {}

  async load(): Promise<StoredConnectorCredential | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch {
      return null;
    }
    try {
      const value = JSON.parse(raw) as Partial<StoredConnectorCredential>;
      if (
        value.version !== CONNECTOR_FILE_VERSION ||
        typeof value.apiBaseUrl !== "string" ||
        typeof value.sessionId !== "string" ||
        typeof value.connectorToken !== "string" ||
        typeof value.connectorExpiresAt !== "number" ||
        typeof value.storedAt !== "number"
      ) {
        return null;
      }
      return value as StoredConnectorCredential;
    } catch {
      return null;
    }
  }

  async save(value: StoredConnectorCredential): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(this.path, 0o600).catch(() => undefined);
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

export function defaultConnectorFilePath(
  home: string,
  env: Record<string, string | undefined>,
  apiBaseUrl = "https://analog-canvas.tokenzhang.com",
): string {
  const override = env.ANALOG_CANVAS_MCP_CONNECTOR;
  if (override?.trim()) return override;
  const origin = new URL(apiBaseUrl).origin;
  const key = createHash("sha256").update(origin).digest("hex");
  return join(home, ".analog-canvas", "connectors", `${key}.json`);
}
