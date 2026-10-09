// The render-and-grade service AnalogArena calls over a service binding
// (docs/specs/analog-arena.md): one Submission's Project and its Task's
// netlist in; its Gallery preview, its netlist and the #1524 verdict out.

import { WorkerEntrypoint } from "cloudflare:workers";
import { type CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  gradeNetlists,
  type NetlistGrade,
} from "../apps/editor/src/headless/grade";
import { PREVIEW_RENDERER_VERSION, renderPreview } from "./gallery-requests";

export interface RenderAndGradeRequest {
  /** The Submission's Project file, as text. */
  projectText: string;
  /** The Task's netlist: SPICE, or structural Spectre. */
  taskNetlist: string;
}

type EquivalenceVerdict =
  { equivalent: true } | { equivalent: false; reason: string };

type RenderAndGradeError = "project-unreadable" | "task-netlist-unreadable";

export type RenderAndGradeAnswer =
  | {
      status: "graded";
      rendererVersion: string;
      /** The Project's top Cell, drawn as its Gallery preview. */
      svg: string;
      /** The top Cell's structural SPICE netlist; null when it does not export. */
      netlist: string | null;
      verdict: EquivalenceVerdict;
    }
  | {
      status: "error";
      rendererVersion: string;
      error: RenderAndGradeError;
      message: string;
    };

/**
 * The service's entrypoint. Only a Worker whose service binding names it can
 * call it; no route of the Worker's public `fetch` reaches it.
 */
export class RenderAndGradeService extends WorkerEntrypoint {
  renderAndGrade(request: RenderAndGradeRequest) {
    return renderAndGrade(request);
  }
}

async function renderAndGrade(
  request: RenderAndGradeRequest,
): Promise<RenderAndGradeAnswer> {
  // Another Worker's input: its type says what it should send, not what it did.
  const { projectText, taskNetlist } = request as {
    projectText?: unknown;
    taskNetlist?: unknown;
  };
  if (typeof projectText !== "string")
    return refused(
      "project-unreadable",
      "The Project must be sent as its file's text.",
    );
  let project: CircuitProject;
  try {
    project = parseProject(projectText);
  } catch (error) {
    return refused(
      "project-unreadable",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (typeof taskNetlist !== "string")
    return refused(
      "task-netlist-unreadable",
      "The Task's netlist must be sent as its text.",
    );
  const unreadable = await taskProblems(taskNetlist);
  if (unreadable) return refused("task-netlist-unreadable", unreadable);

  const svg = await renderPreview(
    project,
    createProjectSymbolResolver(project, builtInSymbols),
  );
  const exported = createDesignNetlistExport(project, { format: "spice" });
  if (exported.status !== "ready")
    return {
      status: "graded",
      rendererVersion: PREVIEW_RENDERER_VERSION,
      svg,
      netlist: null,
      verdict: {
        equivalent: false,
        reason: `The drawing's netlist does not export: ${exported.diagnostics
          .filter((diagnostic) => diagnostic.severity === "error")
          .map((diagnostic) => diagnostic.message)
          .join("; ")}`,
      },
    };
  const grade = await gradeNetlists(exported.file.text, taskNetlist);
  return {
    status: "graded",
    rendererVersion: PREVIEW_RENDERER_VERSION,
    svg,
    netlist: exported.file.text,
    verdict: grade.exact
      ? { equivalent: true }
      : { equivalent: false, reason: differenceOf(grade) },
  };
}

function refused(
  error: RenderAndGradeError,
  message: string,
): RenderAndGradeAnswer {
  return {
    status: "error",
    rendererVersion: PREVIEW_RENDERER_VERSION,
    error,
    message,
  };
}

/**
 * Why a Task's netlist cannot be graded against, or null when it can. As the
 * batch grading requires of a reference (scripts/draw-batch.mjs), it must
 * grade as equivalent to itself.
 */
async function taskProblems(taskNetlist: string): Promise<string | null> {
  const self = await gradeNetlists(taskNetlist, taskNetlist);
  if (self.exact) return null;
  const problems = [
    ...(self.details.error ? [self.details.error] : []),
    ...self.details.problems.reference,
  ];
  return problems.length
    ? problems.join("; ")
    : "The Task's netlist does not grade as equivalent to itself.";
}

/** Why a drawing's netlist is not the Task's, in one sentence. */
function differenceOf({ details }: NetlistGrade): string {
  const devices = Object.entries(details.deviceTypes);
  if (devices.length)
    return `The devices differ: ${devices
      .map(
        ([type, [drawn, task]]) =>
          `${drawn} ${type} drawn, ${task} in the Task`,
      )
      .join("; ")}.`;
  const { connections } = details;
  return `The connections differ: ${connections.shared} of the Task's ${connections.reference} connections are drawn, and ${connections.actual - connections.shared} drawn connections are not the Task's.`;
}
