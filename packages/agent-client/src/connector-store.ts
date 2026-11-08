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
   * every MCP process on this account would otherwise share. The live
   * process holding it resumes from it and keeps it; another live process
   * neither reads nor overwrites it unless it takes the lease over
   * (`takeOver`), and otherwise keeps a connector it paired with a claim
   * code in memory. The holder is looked at again on every use, so one that
   * has exited never blocks: the next process to use the file takes its
   * stale lease.
   */
  lease?: boolean;
}

export class ConnectorStore {
  /** Whether this process held the lease when it last looked. */
  private held = false;
  /** This process's own credential, once read or saved under a lease. */
  private memory: StoredConnectorCredential | null | undefined;
  /** The live process holding the lease when this one last could not. */
  heldBy: number | null = null;
  /**
   * Another process took over the lease this one held, and with it the
   * connector this one read or saved: this process never uses that again
   * until `takeOver` takes it back.
   */
  takenOver = false;

  constructor(
    readonly path: string,
    private readonly options: ConnectorStoreOptions = {},
  ) {}

  get leasePath(): string {
    return `${this.path}.lease`;
  }

  async load(): Promise<StoredConnectorCredential | null> {
    if (!this.options.lease) return this.read();
    // This process trusts what it read or saved itself: another process
    // writing the file (an older MCP, a CLI command) cannot redirect it.
    if (this.memory) return (await this.keeps()) ? this.memory : null;
    if (this.takenOver) return null;
    this.memory = (await this.holds()) ? await this.read() : null;
    return this.memory;
  }

  async save(value: StoredConnectorCredential): Promise<void> {
    if (this.options.lease) {
      const kept = this.memory;
      const held = this.takenOver ? false : await this.holds();
      // Refreshing the connector the taker now holds keeps nothing; a new
      // pairing (a claim code) is this process's own, kept in memory.
      if (
        !held &&
        this.takenOver &&
        kept?.connectorToken === value.connectorToken
      )
        return;
      this.memory = value;
      if (!held) return;
    }
    await mkdir(dirname(this.path), { recursive: true });
    await writeAtomically(this.path, `${JSON.stringify(value, null, 2)}\n`);
  }

  /**
   * Forget the saved connector. Given `ownConnectorToken`, the file goes only
   * while it still holds that connector: a process that was taken over must
   * not delete the one that replaced it.
   */
  async clear(ownConnectorToken?: string): Promise<void> {
    if (this.options.lease) {
      // Only a holder touches the file: clearing never takes a lease.
      const held = this.held && (await this.stillHeld());
      this.memory = null;
      if (!held) return;
    }
    if (
      ownConnectorToken !== undefined &&
      (await this.read())?.connectorToken !== ownConnectorToken
    )
      return;
    await rm(this.path, { force: true });
  }

  /**
   * Hold the lease even while another live process holds it, for a connect
   * without a claim code: the latest such connect owns the saved connector,
   * so a process its client abandoned cannot keep it. The process it
   * replaces finds out on its next use (`takenOver`). Nothing is taken when
   * this process keeps a pairing of its own in memory, or when the file has
   * no connector to resume. Returns the live process it took the lease from.
   */
  async takeOver(): Promise<number | null> {
    if (!this.options.lease) return null;
    if (this.memory && !this.held) return null;
    if (this.held && (await this.stillHeld())) return null;
    if ((await this.read()) === null) return null;
    const previous = await this.holder();
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeAtomically(
        this.leasePath,
        `${JSON.stringify({ pid: process.pid })}\n`,
      );
    } catch {
      return null;
    }
    this.held = true;
    this.takenOver = false;
    this.heldBy = null;
    this.memory = undefined;
    return previous !== null &&
      previous !== process.pid &&
      processRuns(previous)
      ? previous
      : null;
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
   * Whether this process holds the lease, acquiring it when no live process
   * does. Looked at on each use, never decided once: a holder that exits
   * stops blocking at once.
   */
  private async holds(): Promise<boolean> {
    if (this.held) return this.stillHeld();
    this.held = await this.acquire();
    return this.held;
  }

  /**
   * Whether this process's lease still stands. Another process rewriting it
   * took over: a live one by `takeOver`, or one that found it stale at the
   * same moment. What this process kept is that process's now.
   */
  private async stillHeld(): Promise<boolean> {
    const holder = await this.holder();
    if (holder === process.pid) return true;
    this.held = false;
    this.takenOver = true;
    this.heldBy = holder;
    if (this.memory !== undefined) this.memory = null;
    return false;
  }

  /** A process whose own pairing lives in memory keeps it, lease or not. */
  private async keeps(): Promise<boolean> {
    return !this.held || (await this.stillHeld());
  }

  private async acquire(): Promise<boolean> {
    const mine = `${JSON.stringify({ pid: process.pid })}\n`;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      try {
        await writeFile(this.leasePath, mine, { flag: "wx", mode: 0o600 });
        this.heldBy = null;
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const holder = await this.holder();
      if (holder !== process.pid && holder !== null && processRuns(holder)) {
        this.heldBy = holder;
        return false;
      }
      // Its holder has exited: take the lease over in one step. Two
      // processes doing so at once both look again before touching the
      // connector, and only the last writer keeps it.
      if (holder !== process.pid) await writeAtomically(this.leasePath, mine);
      this.heldBy = null;
      return (await this.holder()) === process.pid;
    } catch {
      // A lease that cannot be read or written is never shared.
      return false;
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
