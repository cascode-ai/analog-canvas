// The render-and-grade service AnalogArena calls over a service binding
// (docs/specs/analog-arena.md): one Submission's Project and its Task's
// netlist in; its Gallery preview, its netlist and the #1524 verdict out.

import { WorkerEntrypoint } from "cloudflare:workers";
import { type CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { workspaceNetlist } from "../apps/editor/src/headless/artifacts";
import { explainGrade, gradeNetlists } from "../apps/editor/src/headless/grade";
import { PREVIEW_RENDERER_VERSION, renderPreview } from "./gallery-requests";

export interface RenderAndGradeRequest {
  /** The Submission's Project file, as text. */
  projectText: string;
  /** The Task's netlist: SPICE, or structural Spectre. */
  taskNetlist: string;
}

type EquivalenceVerdict =
  | { equivalent: true }
  | { equivalent: false; reason: string }
  /** The drawing's structure does not export, so it was not graded. */
  | { equivalent: false; blocked: true; reason: string };

type RenderAndGradeError =
  | "project-unreadable"
  | "task-netlist-unreadable"
  /** The renderer, the export or the grading failed unexpectedly. */
  | "internal";

export type RenderAndGradeAnswer =
  | {
      status: "graded";
      rendererVersion: string;
      /** The Project's top Cell, drawn as its Gallery preview. */
      svg: string;
      /** The top Cell's structural SPICE netlist; null when it does not export. */
      netlist: string | null;
      /** Why `netlist` is null: the export's errors. Empty when it is set. */
      exportErrors: string[];
      verdict: EquivalenceVerdict;
    }
  | {
      status: "error";
      rendererVersion: string;
      error: RenderAndGradeError;
      message: string;
    };

type Structure = ReturnType<typeof workspaceNetlist>;

/**
 * The batch grading's rules (#1524), with source polarity scored: a Task
 * netlist fixes it, and a drawn source marks it.
 */
const GRADING = { sourcePolarity: true };

/**
 * The service's entrypoint. Only a Worker whose service binding names it can
 * call it; no route of the Worker's public `fetch` reaches it.
 */
export class RenderAndGradeService extends WorkerEntrypoint {
  async renderAndGrade(
    request: RenderAndGradeRequest,
  ): Promise<RenderAndGradeAnswer> {
    // Every call gets an answer; no exception crosses the binding.
    try {
      return await renderAndGrade(request);
    } catch (error) {
      console.error("Render-and-grade failed", error);
      return refused("internal", messageOf(error));
    }
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
    return refused("project-unreadable", messageOf(error));
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
  const exported = workspaceNetlist(project);
  const structure =
    exported.text === null ? (structureOf(project) ?? exported) : exported;
  return {
    status: "graded",
    rendererVersion: PREVIEW_RENDERER_VERSION,
    svg,
    netlist: exported.text,
    exportErrors: exported.text === null ? exported.messages : [],
    verdict: await verdictOf(structure, taskNetlist),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const self = await gradeNetlists(taskNetlist, taskNetlist, GRADING);
  if (self.exact) return null;
  const problems = [
    ...(self.details.error ? [self.details.error] : []),
    ...self.details.problems.reference,
  ];
  return problems.length
    ? problems.join("; ")
    : "The Task's netlist does not grade as equivalent to itself.";
}

/** A value for a parameter the drawing leaves out. No grade reads values. */
const UNREAD_VALUE = "1";

/**
 * The drawing's export with every missing parameter value filled, or null
 * when anything but a missing value blocks it. Parameters are a separate
 * score (#1524) and no grade reads a value, so the filled export grades the
 * structure; it is never handed out.
 */
function structureOf(project: CircuitProject): Structure | null {
  const errors = createDesignNetlistExport(project, {
    format: "spice",
  }).diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const filled = structuredClone(project);
  for (const { code, documentId, objectIds, parameter } of errors) {
    const instance =
      code === "MISSING_REQUIRED_PARAMETER"
        ? filled.documents
            .find((document) => document.id === documentId)
            ?.instances.find((candidate) => candidate.id === objectIds[0])
        : undefined;
    if (!instance || parameter === undefined) return null;
    const kept = Object.entries(instance.netlist?.parameters ?? {}).filter(
      ([name]) => name.toLowerCase() !== parameter.toLowerCase(),
    );
    instance.netlist = {
      ...instance.netlist,
      parameters: { ...Object.fromEntries(kept), [parameter]: UNREAD_VALUE },
    };
  }
  return workspaceNetlist(filled);
}

async function verdictOf(
  structure: Structure,
  taskNetlist: string,
): Promise<EquivalenceVerdict> {
  if (structure.text === null)
    return {
      equivalent: false,
      blocked: true,
      reason: `The drawing's netlist does not export: ${structure.messages.join("; ")}`,
    };
  const grade = await gradeNetlists(structure.text, taskNetlist, GRADING);
  return grade.exact
    ? { equivalent: true }
    : { equivalent: false, reason: explainGrade(grade) };
}
