import { readFileSync, rmSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

/** Persistent M4 pairing record. Short-lived Circuit bearers are never stored. */
export interface StoredConnectorCredential {
  version: 1;
  apiBaseUrl: string;
  sessionId: string;
  connectorToken: string;
  connectorExpiresAt: number;
  storedAt: number;
}

const CONNECTOR_FILE_VERSION = 1;

export interface ConnectorStoreOptions {
  /**
   * Hold the file by a lease (#1522), for the default per-origin file that
   * every MCP process on this account would otherwise share. The first live
   * process to use it holds it, resumes from it and keeps it; another live
   * process neither reads nor overwrites it, keeps its own connector in
   * memory and pairs with a claim code. A holder that has exited leaves a
   * stale lease, which the next process takes over, so one client
   * restarting still resumes its own connection.
   */
  lease?: boolean;
}

export class ConnectorStore {
  private leaseState: Promise<"held" | "private"> | undefined;
  /** This process's own credential, once read or saved under a lease. */
  private memory: StoredConnectorCredential | null | undefined;
  /** The live process holding the lease when this one could not. */
  heldBy: number | null = null;

  constructor(
    readonly path: string,
    private readonly options: ConnectorStoreOptions = {},
  ) {}

  get leasePath(): string {
    return `${this.path}.lease`;
  }

  async load(): Promise<StoredConnectorCredential | null> {
    if (!this.options.lease) return this.read();
    // The holder trusts what it read or saved itself: another process
    // writing the file (an older MCP, a CLI command) cannot redirect it.
    if (this.memory !== undefined) return this.memory;
    this.memory = (await this.holds()) ? await this.read() : null;
    return this.memory;
  }

  async save(value: StoredConnectorCredential): Promise<void> {
    if (this.options.lease) {
      this.memory = value;
      if (!(await this.holds())) return;
    }
    await mkdir(dirname(this.path), { recursive: true });
    await writeAtomically(this.path, `${JSON.stringify(value, null, 2)}\n`);
  }

  async clear(): Promise<void> {
    if (this.options.lease) {
      this.memory = null;
      if (!(await this.holds())) return;
    }
    await rm(this.path, { force: true });
  }

  /** Give the lease back as the process ends; a crash leaves it stale. */
  releaseSync(): void {
    if (!this.options.lease) return;
    try {
      if (leaseHolder(readFileSync(this.leasePath, "utf8")) === process.pid)
        rmSync(this.leasePath, { force: true });
    } catch {
      // Nothing to give back.
    }
  }

  private async read(): Promise<StoredConnectorCredential | null> {
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

  /**
   * Whether this process holds the lease. Decided on first use and then
   * only ever lost, never regained: a process that once kept its connector
   * to itself never takes over the shared file mid-run.
   */
  private async holds(): Promise<boolean> {
    this.leaseState ??= this.acquire();
    if ((await this.leaseState) === "private") return false;
    // Checked again on each use, in case another process took over a lease
    // it found stale at the same moment this one did.
    if ((await this.holder()) === process.pid) return true;
    this.leaseState = Promise.resolve("private");
    return false;
  }

  private async acquire(): Promise<"held" | "private"> {
    const mine = `${JSON.stringify({ pid: process.pid })}\n`;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      try {
        await writeFile(this.leasePath, mine, { flag: "wx", mode: 0o600 });
        return "held";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const holder = await this.holder();
      if (holder === process.pid) return "held";
      if (holder !== null && processRuns(holder)) {
        this.heldBy = holder;
        return "private";
      }
      // Its holder has exited: take the lease over in one step. Two
      // processes doing so at once both look again before touching the
      // connector, and only the last writer keeps it.
      await writeAtomically(this.leasePath, mine);
      return "held";
    } catch {
      // A lease that cannot be read or written is never shared.
      return "private";
    }
  }

  private async holder(): Promise<number | null> {
    try {
      return leaseHolder(await readFile(this.leasePath, "utf8"));
    } catch {
      return null;
    }
  }
}

function leaseHolder(raw: string): number | null {
  try {
    const pid = (JSON.parse(raw) as { pid?: unknown }).pid;
    return Number.isInteger(pid) && (pid as number) > 0
      ? (pid as number)
      : null;
  } catch {
    return null;
  }
}

/** Whether a process runs: signal 0 only checks; EPERM is someone else's. */
function processRuns(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Readers see the old file or the new one, never half of either. */
async function writeAtomically(path: string, text: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600).catch(() => undefined);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
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
