/**
 * What the in-browser simulator is, measured from the bytes it loaded and
 * checked against the hosted SKY130 Profile's `browser` pin: the WebAssembly
 * binary, the continuous model subtree (by the harness's tree digest), the
 * standard-cell libraries and the startup file. Only a full match runs, and
 * runs report it as `browser-wasm`, `pinned` — never as the hosted image.
 */
import {
  createSimulationEnvironmentMetadata,
  type SimulationEnvironmentMetadata,
} from "@icm/spice-run";
import hostedProfile from "../../../../../../containers/ngspice/hosted-sky130-profile.json" with { type: "json" };
import type { NgspiceLibraryFile } from "./ngspice-batch";

export const BROWSER_NGSPICE_PROFILE = hostedProfile;

type Bytes = Uint8Array<ArrayBuffer>;

export interface BrowserNgspiceAssets {
  wasm: Bytes;
  /** What `ngspice --version` printed, or null when it said nothing readable. */
  version: string | null;
  /** The continuous library's files, by name within its directory. */
  models: readonly { name: string; bytes: Bytes }[];
  /** Each Profile cell library's file, by file name. */
  cells: readonly { name: string; bytes: Bytes }[];
  startup: string;
}

export type BrowserNgspiceEnvironment =
  | {
      ok: true;
      environment: SimulationEnvironmentMetadata;
      /** Every Profile library file at its runtime path. */
      libraries: NgspiceLibraryFile[];
    }
  | { ok: false; message: string };

function hex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function sha256Bytes(bytes: Bytes): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

/**
 * The harness's `sha256Tree` (containers/ngspice/entrypoint.mjs) over one
 * flat directory: each file's JSON-quoted name, byte length and bytes,
 * NUL-separated, in name order.
 */
async function modelTreeSha256(
  files: readonly { name: string; bytes: Bytes }[],
): Promise<string> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const nul = new Uint8Array([0]);
  for (const file of [...files].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  ))
    parts.push(
      encoder.encode(JSON.stringify(file.name)),
      nul,
      encoder.encode(String(file.bytes.byteLength)),
      nul,
      file.bytes,
      nul,
    );
  const joined = new Uint8Array(
    parts.reduce((size, part) => size + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return sha256Bytes(joined);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The version string the harness reads from `ngspice --version`. */
export function ngspiceVersion(output: string): string | null {
  const match = output.match(/\bngspice[-\s]+([0-9][A-Za-z0-9.+-]*)/iu);
  return match ? `ngspice-${match[1]}` : null;
}

export async function measureBrowserNgspice(
  assets: BrowserNgspiceAssets,
): Promise<BrowserNgspiceEnvironment> {
  const pin = hostedProfile.browser;
  const [binarySha256, modelSha256, startupSha256, cellSha256] =
    await Promise.all([
      sha256Bytes(assets.wasm),
      modelTreeSha256(assets.models),
      sha256Bytes(new TextEncoder().encode(assets.startup)),
      Promise.all(
        hostedProfile.cellLibraries.map(async (library) => {
          const file = assets.cells.find(
            (cell) => cell.name === basename(library.library.runtimePath),
          );
          return file ? sha256Bytes(file.bytes) : "missing";
        }),
      ),
    ]);
  const mismatches = [
    ["simulator version", hostedProfile.simulator.version, assets.version],
    ["WebAssembly binary SHA-256", pin.simulator.binarySha256, binarySha256],
    ["model subtree SHA-256", pin.models.contentSha256, modelSha256],
    ["startup SHA-256", hostedProfile.startup.contentSha256, startupSha256],
    ...hostedProfile.cellLibraries.map((library, index) => [
      `cell library ${library.id} SHA-256`,
      library.contentSha256,
      cellSha256[index],
    ]),
  ].filter(([, expected, actual]) => expected !== actual);
  if (mismatches.length > 0)
    return {
      ok: false,
      message: `The in-browser simulator does not match Profile ${hostedProfile.id}: ${mismatches
        .map(
          ([label, expected, actual]) =>
            `${label} expected ${expected}, observed ${actual}`,
        )
        .join("; ")}`,
    };
  return {
    ok: true,
    environment: await createSimulationEnvironmentMetadata({
      executor: "browser-wasm",
      reproducibility: "pinned",
      profileId: hostedProfile.id,
      platform: pin.platform,
      simulator: {
        name: "ngspice",
        version: hostedProfile.simulator.version,
        binarySha256,
      },
      models: { id: hostedProfile.models.id, contentSha256: modelSha256 },
      startupSha256,
    }),
    libraries: [
      ...assets.models.map((file) => ({
        path: `${pin.models.root}/${file.name}`,
        bytes: file.bytes,
      })),
      ...hostedProfile.cellLibraries.map((library) => ({
        path: library.library.runtimePath,
        bytes: assets.cells.find(
          (cell) => cell.name === basename(library.library.runtimePath),
        )!.bytes,
      })),
    ],
  };
}
