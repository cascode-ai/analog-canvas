import type { CircuitProject } from "@icm/model";
import { projectChangeToken } from "./project-session-lifecycle";

export interface ProjectSaveSession {
  id: string;
  project: CircuitProject;
}

/** An owned snapshot; storage must never receive the live mutable Project. */
export function captureProjectSaveSnapshot(
  candidate: CircuitProject,
  sessionId: string,
  current: () => ProjectSaveSession | null,
) {
  const project = structuredClone(candidate);
  const token = projectChangeToken(project);
  return {
    project,
    isCurrent: () => current()?.id === sessionId,
    matchesCurrentProject: () => {
      const live = current();
      return (
        live?.id === sessionId && projectChangeToken(live.project) === token
      );
    },
  };
}

export type ProjectSaveSnapshot = ReturnType<typeof captureProjectSaveSnapshot>;
export type ProjectSaveRejection = "busy" | "drafts" | "session-changed";

interface ProjectSaveRequest<Outcome> {
  sessionId: string;
  current(): ProjectSaveSession | null;
  candidate?: CircuitProject;
  /** Flush feature-owned buffers before capturing a durable snapshot. */
  beforeSnapshot?(): Promise<CircuitProject | null>;
  asNew?: boolean;
  /** Host-owned persistence, recovery staging and acknowledgement. */
  write(snapshot: ProjectSaveSnapshot): Promise<Outcome>;
  rejected(reason: ProjectSaveRejection): Outcome;
  failed(error: unknown, stillCurrent: boolean): Outcome;
}

/**
 * One active editor save at a time, independent of Cloud or native storage.
 * Repeated Save joins the pending operation; Save As cannot change its target.
 * Storage receipts, revision conflicts and cancellation retain their host types.
 */
export function createProjectSaveCoordinator<Outcome>() {
  let inFlight: Promise<Outcome> | null = null;
  return {
    isSaving: () => inFlight !== null,
    save(request: ProjectSaveRequest<Outcome>): Promise<Outcome> {
      if (inFlight)
        return request.asNew
          ? Promise.resolve(request.rejected("busy"))
          : inFlight;
      const operation = (async () => {
        const candidate =
          request.candidate ??
          (request.beforeSnapshot
            ? await request.beforeSnapshot()
            : request.current()?.project);
        if (!candidate) return request.rejected("drafts");
        if (request.current()?.id !== request.sessionId)
          return request.rejected("session-changed");
        return request.write(
          captureProjectSaveSnapshot(
            candidate,
            request.sessionId,
            request.current,
          ),
        );
      })().catch((error: unknown) =>
        request.failed(error, request.current()?.id === request.sessionId),
      );
      inFlight = operation;
      const clear = () => {
        if (inFlight === operation) inFlight = null;
      };
      void operation.then(clear, clear);
      return operation;
    },
  };
}
