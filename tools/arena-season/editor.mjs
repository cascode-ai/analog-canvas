// What the Season tool (#1560) uses of Analog Canvas, as it is on main: the
// Project file format, the netlist exporter with the Gallery's
// finished-drawing gate, the Gallery preview renderer, the #1524 grader and
// the editor's own Agent host for the generated drawings.
import { createHash } from "node:crypto";

import {
  createDesignNetlistExport,
  createDraftNetlistPreview,
  unfinishedDrawingDiagnostics,
} from "@icm/netlist";
import { parseProject, serializeProject } from "@icm/project-protocol";

import { AI_SEATS } from "../../worker/auth-do.ts";
import {
  createLocalEditor,
  gradeNetlists,
  workspaceSvg,
} from "../../apps/editor/src/headless/index.ts";
import { withImportedInstanceDisplays } from "../../apps/editor/src/features/instance-display/imported-instance-displays.ts";
import { importSpiceSources } from "../../packages/spice/src/index.ts";

export {
  createLocalEditor,
  gradeNetlists,
  importSpiceSources,
  parseProject,
  serializeProject,
  withImportedInstanceDisplays,
};

/**
 * The structural SPICE netlist the editor exports for the Project, or why
 * it cannot. `unfinished` lists what the Gallery's finished-drawing gate
 * refuses (a wire that reaches no other pin) although a netlist printed.
 */
export function exportNetlist(project) {
  const result = createDesignNetlistExport(project, { format: "spice" });
  const blocking = result.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  const errors = blocking.map((diagnostic) => diagnostic.message);
  if (result.status !== "ready")
    return {
      text: null,
      errors,
      // Blocked only because required device values are missing.
      valuesOnly:
        blocking.length > 0 &&
        blocking.every(
          (diagnostic) => diagnostic.code === "MISSING_REQUIRED_PARAMETER",
        ),
      unfinished: [],
    };
  return {
    text: result.file.text,
    errors,
    valuesOnly: false,
    unfinished: unfinishedDrawingDiagnostics(result.diagnostics).map(
      (diagnostic) => diagnostic.message,
    ),
  };
}

/**
 * The editor's draft netlist of a drawing that does not export yet: each
 * missing value, model or connection printed as `?`. Null when even a
 * draft cannot be printed.
 */
export function draftNetlist(project) {
  return createDraftNetlistPreview(project, { format: "spice" })?.text ?? null;
}

/** The top Cell as the Gallery renders its preview (gallery-requests.ts). */
export function renderSvg(project) {
  return workspaceSvg(project);
}

/** The display names the AI accounts publish under, now and before. */
export const AI_AUTHOR_NAMES = new Set(
  AI_SEATS.flatMap((seat) => [seat.displayName, seat.formerName])
    .filter(Boolean)
    .map((name) => name.trim().toLowerCase()),
);

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/**
 * Run `work` with the editor's fresh IDs drawn from a counter seeded by
 * `seed` instead of `crypto.randomUUID`. The Agent host names every new wire
 * and label with a random UUID; a Season build must give the same Projects,
 * byte for byte, every time it runs on the same inputs.
 */
export async function withSeededIds(seed, work) {
  const cryptoObject = globalThis.crypto;
  const own = Object.getOwnPropertyDescriptor(cryptoObject, "randomUUID");
  let counter = 0;
  Object.defineProperty(cryptoObject, "randomUUID", {
    configurable: true,
    writable: true,
    value: () => {
      const hex = sha256(`${seed}:${counter++}`);
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    },
  });
  try {
    return await work();
  } finally {
    if (own) Object.defineProperty(cryptoObject, "randomUUID", own);
    else delete cryptoObject.randomUUID;
  }
}

/** A seeded generator in [0, 1) (mulberry32): the same seed, the same run. */
export function seededRandom(seed) {
  let state = Number.parseInt(sha256(seed).slice(0, 8), 16);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
