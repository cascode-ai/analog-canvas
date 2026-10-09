// The Agent's requests about the project tabs: listing, opening, saving,
// renaming and copying between them, and the hosts that serve a background tab.
import type { Dispatch, RefObject, SetStateAction } from "react";
import { createEmptyProject, createId } from "@icm/model";
import { createAgentGalleryPublisher } from "../agent/agent-gallery-publish";
import { BrowserAgentFileHost } from "../agent/browser-agent-file-host";
import { BrowserAgentHost } from "../agent/browser-agent-host";
import { BrowserAgentProjectHost } from "../agent/browser-agent-project-host";
import { BrowserAgentSimulationHost } from "../agent/browser-agent-simulation-host";
import {
  EDITOR_PROJECT_TRANSACTION_OPTIONS,
  type EditorDocumentController,
  type useDocumentController,
} from "../document/document-controller";
import { captureProjectSaveSnapshot } from "../document/project-save-coordinator";
import type { UseRecoveryCoordinatorResult } from "../document/recovery-coordinator";
import type { useProjectFileLifecycle } from "../document/use-project-file-lifecycle";
import {
  applyProjectCopyPlacement,
  captureProjectCopy,
  planProjectCopyPlacement,
} from "../features/clipboard/project-copy";
import type { CloudProjectSummary } from "../features/editor-shell/cloud-projects";
import type { createProjectStructureCommands } from "../features/hierarchy/project-structure-commands";
import { ProjectRunHistory } from "../features/simulation/project-run-history";
import type { EditorServices } from "../services/editor-services";
import { DEFAULT_VIEWBOX } from "./default-view-box";
import type {
  useAgentProjectResources,
  useBrowserAgentHost,
  useEditorAgentConnection,
} from "./use-agent-hosts";
import type { useProjectTabSessions } from "./use-project-tab-sessions";

type DocumentControllerState = ReturnType<typeof useDocumentController>;
type ProjectFileLifecycle = ReturnType<typeof useProjectFileLifecycle>;
type ProjectStructureCommands = ReturnType<
  typeof createProjectStructureCommands
>;
type ProjectTabSessions = ReturnType<typeof useProjectTabSessions>;
type BrowserAgentHostState = ReturnType<typeof useBrowserAgentHost>;
type AgentProjectResources = ReturnType<typeof useAgentProjectResources>;
type AgentProjectResourcesOptions = Parameters<
  typeof useAgentProjectResources
>[0];
type AgentConnection = ReturnType<typeof useEditorAgentConnection>;

/** Serves the Agent's `workspace` requests from the open project tabs. */
export function createAgentWorkspaceHandler({
  projectStore,
  stageRecovery,
  flushRecovery,
  editorDocumentController,
  synchronizeExternalCommit,
  setCloudProjects,
  cloudListMutationRef,
  simulationSourceBuffer,
  codeDraftDirty,
  restoreFileSession,
  saveProjectToCloud,
  openCloudProjectById,
  renameProject,
  createTabSession,
  projectSwitchBlocker,
  projectTabs,
}: {
  projectStore: EditorServices["projectStore"];
  stageRecovery: UseRecoveryCoordinatorResult["stage"];
  flushRecovery: UseRecoveryCoordinatorResult["flushNow"];
  editorDocumentController: EditorDocumentController;
  synchronizeExternalCommit: DocumentControllerState["synchronizeExternalCommit"];
  setCloudProjects: Dispatch<SetStateAction<readonly CloudProjectSummary[]>>;
  cloudListMutationRef: RefObject<number>;
  simulationSourceBuffer: RefObject<{
    dirty: boolean;
    flush(): Promise<boolean>;
  } | null>;
  codeDraftDirty: boolean;
  restoreFileSession: ProjectFileLifecycle["restoreFileSession"];
  saveProjectToCloud: ProjectFileLifecycle["saveProjectToCloud"];
  openCloudProjectById: ProjectFileLifecycle["openCloudProjectById"];
  renameProject: ProjectStructureCommands["renameProject"];
  createTabSession: ProjectTabSessions["createTabSession"];
  projectSwitchBlocker: ProjectTabSessions["projectSwitchBlocker"];
  projectTabs: ProjectTabSessions["projectTabs"];
}): AgentProjectResources["agentWorkspaceRef"]["current"] {
  return async (envelope, targetWorkspaceId) => {
    const request = envelope.request;
    const { copyWorkspaceCell, listWorkspaceProjects, workspaceResponses } =
      await import("../agent/workspace-copy");
    const { fail, success } = workspaceResponses(envelope.requestId);
    try {
      const entries = projectTabs.entries();
      if (request.action === "list")
        return success({
          action: "list",
          activeWorkspaceId: projectTabs.activeId,
          projects: listWorkspaceProjects(entries),
        });
      if (request.action === "activate") {
        if (!entries.some((e) => e.id === request.workspaceId))
          return fail("WORKSPACE_NOT_FOUND", "Workspace is no longer open");
        const applied = await projectTabs.select(request.workspaceId);
        return applied
          ? success({ action: "activate", applied })
          : fail(
              "WORKSPACE_BUSY",
              `Can't switch Projects yet: ${projectSwitchBlocker() ?? "another Project operation is running"}`,
            );
      }
      if (request.action === "open") {
        const result = await openCloudProjectById(
          request.cloudProjectId,
          true,
          request.background === true,
        );
        return result.applied
          ? success({
              action: "open",
              applied: true,
              workspaceId: projectTabs
                .entries()
                .find(
                  (item) =>
                    item.session.file.cloudBinding?.id ===
                    request.cloudProjectId,
                )?.id,
            })
          : fail(
              "CLOUD_OPEN_FAILED",
              result.message ?? "Cloud Project was not opened",
            );
      }
      if (request.action === "save") {
        if (!projectStore)
          return fail("INVALID_REQUEST", "Cloud storage is unavailable");
        if (targetWorkspaceId && targetWorkspaceId !== projectTabs.activeId) {
          const target = entries.find((item) => item.id === targetWorkspaceId);
          if (!target)
            return fail(
              "WORKSPACE_NOT_FOUND",
              "Working copy is no longer open",
            );
          const controller = target.session.controller;
          const snapshot = captureProjectSaveSnapshot(
            controller.project,
            controller.projectSessionId,
            () => {
              const live = projectTabs
                .entries()
                .find(
                  (item) =>
                    item.id === targetWorkspaceId &&
                    item.session.controller === controller,
                );
              return live
                ? {
                    id: controller.projectSessionId,
                    project: controller.project,
                  }
                : null;
            },
          );
          const candidate = snapshot.project;
          target.session.file.persistenceState = "saving";
          projectTabs.changed();
          const outcome = await projectStore.save(
            candidate,
            request.asNew ? null : target.session.file.cloudBinding,
          );
          const liveTarget = projectTabs
            .entries()
            .find(
              (item) =>
                item.id === targetWorkspaceId &&
                item.session.controller === controller,
            );
          if (!liveTarget)
            return fail(
              "WORKSPACE_NOT_FOUND",
              "Working copy closed while Cloud save was in flight; check the Cloud Project shelf",
            );
          if (outcome.status === "saved") {
            const stillCurrent =
              snapshot.matchesCurrentProject() &&
              (targetWorkspaceId !== projectTabs.activeId ||
                (!codeDraftDirty &&
                  simulationSourceBuffer.current?.dirty !== true));
            liveTarget.session.file.cloudBinding = {
              id: outcome.project.id,
              revision: outcome.project.revision,
              galleryEntryId: outcome.project.galleryEntryId ?? null,
            };
            liveTarget.session.file.savedBaseline = {
              project: candidate,
              viewBox: { ...liveTarget.session.view },
            };
            liveTarget.session.file.persistenceState = stillCurrent
              ? "clean"
              : "dirty";
            liveTarget.session.dirty = !stillCurrent;
            liveTarget.session.unsafe = !stillCurrent;
            if (targetWorkspaceId === projectTabs.activeId) {
              restoreFileSession(liveTarget.session.file);
              stageRecovery(controller.project, {
                cloudBinding: liveTarget.session.file.cloudBinding,
                unsavedAtSnapshot: !stillCurrent,
              });
              void flushRecovery();
            }
            cloudListMutationRef.current += 1;
            setCloudProjects((current) => [
              outcome.project,
              ...current.filter((item) => item.id !== outcome.project.id),
            ]);
            projectTabs.changed();
            const { id, name, revision, updatedAt, schemaVersion } =
              outcome.project;
            return success({
              action: "save",
              project: { id, name, revision, updatedAt, schemaVersion },
            });
          }
          liveTarget.session.file.persistenceState =
            outcome.status === "conflict"
              ? "conflict"
              : outcome.status === "unreachable"
                ? "offline"
                : "failed";
          if (targetWorkspaceId === projectTabs.activeId)
            restoreFileSession(liveTarget.session.file);
          projectTabs.changed();
          return fail(
            `CLOUD_SAVE_${outcome.status.toUpperCase().replaceAll("-", "_")}`,
            outcome.status === "conflict"
              ? `Cloud revision ${outcome.project.revision} conflicts with this working copy; nothing overwritten`
              : "message" in outcome
                ? outcome.message
                : `Cloud save ${outcome.status}; local work retained`,
          );
        }
        const outcome = await saveProjectToCloud(
          undefined,
          request.asNew === true,
        );
        if (outcome.status !== "saved")
          return fail(
            `CLOUD_SAVE_${outcome.status.toUpperCase().replaceAll("-", "_")}`,
            outcome.status === "conflict"
              ? `Cloud revision ${outcome.project.revision} conflicts with this working copy; nothing overwritten`
              : "message" in outcome
                ? outcome.message
                : `Cloud save ${outcome.status}; local work retained`,
          );
        const { id, name, revision, updatedAt, schemaVersion } =
          outcome.project;
        return success({
          action: "save",
          project: { id, name, revision, updatedAt, schemaVersion },
        });
      }
      if (request.action === "new") {
        // A blank working copy, as the tab strip's + opens one.
        const open = new Set(entries.map((item) => item.id));
        const blank = createEmptyProject(
          createId("project"),
          request.name?.trim() || "New Circuit",
          createId("document"),
        );
        const applied = request.background
          ? projectTabs.openBackground(() => createTabSession(blank))
          : await projectTabs.open(() => createTabSession(blank));
        const workspaceId = projectTabs
          .entries()
          .find((item) => !open.has(item.id))?.id;
        return applied && workspaceId
          ? success({ action: "new", applied: true, workspaceId })
          : fail(
              "WORKSPACE_BUSY",
              `Can't open a Project yet: ${projectSwitchBlocker() ?? "another Project operation is running"}`,
            );
      }
      if (request.action === "rename") {
        const name = request.name.trim();
        const workspaceId =
          request.workspaceId ?? targetWorkspaceId ?? projectTabs.activeId;
        const target = entries.find((item) => item.id === workspaceId);
        if (!target)
          return fail("WORKSPACE_NOT_FOUND", "Working copy is no longer open");
        if (!name)
          return fail("INVALID_REQUEST", "A Project name cannot be blank");
        const controller = target.session.controller;
        if (controller.project.name === name)
          return success({ action: "rename", applied: false, workspaceId });
        if (workspaceId === projectTabs.activeId) {
          // The Project menu's own rename: one undoable Project edit.
          renameProject(name);
          if (editorDocumentController.project.name !== name)
            return fail("RENAME_REJECTED", "The Project name was not changed");
        } else {
          const result = controller.dispatchProjectTransaction({
            transactionId: `agent-rename-project-${envelope.requestId}`,
            projectId: controller.project.id,
            expectedStructureRevision: controller.project.structureRevision,
            actor: { kind: "agent", id: "workspace" },
            edits: [{ kind: "rename_project", name }],
          });
          if (!result.ok || !result.applied)
            return fail("RENAME_REJECTED", "The Project name was not changed");
          target.session.dirty = true;
          if (target.session.file.persistenceState === "clean")
            target.session.file.persistenceState = "dirty";
          projectTabs.changed();
        }
        controller.noteAgentEdit();
        return success({ action: "rename", applied: true, workspaceId });
      }
      const source = entries.find((e) => e.id === request.sourceWorkspaceId)
        ?.session.controller;
      const target = entries.find((e) => e.id === request.targetWorkspaceId);
      if (!target)
        return fail("WORKSPACE_NOT_FOUND", "Target Project is no longer open");
      const copied = copyWorkspaceCell(
        request,
        source,
        target.session.controller,
        {
          captureProjectCopy,
          planProjectCopyPlacement,
          applyProjectCopyPlacement: (plan, actor) =>
            applyProjectCopyPlacement(
              plan,
              actor,
              EDITOR_PROJECT_TRANSACTION_OPTIONS,
            ),
        },
      );
      if ("error" in copied)
        return fail(copied.error.code, copied.error.message);
      if (target.id === projectTabs.activeId) {
        synchronizeExternalCommit();
        void flushRecovery();
      } else {
        target.session.dirty = true;
        target.session.unsafe = true;
        target.session.file.persistenceState = "dirty";
      }
      projectTabs.changed();
      return success(copied.result);
    } catch (error) {
      return fail(
        "WORKSPACE_OPERATION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  };
}

/** The hosts an Agent request addressed to one project tab is served by. */
export function createAgentWorkspaceTargets({
  flushRecovery,
  synchronizeExternalCommit,
  agentPlanning,
  browserAgentHost,
  simulationTransport,
  projectSwitchBlockerRef,
  openProjectInTabRef,
  setAgentFileCandidate,
  agentProjectResources,
  browserAgentFileHost,
  browserAgentSimulationHost,
  agentWorkspaceRef,
  browserAgentProjectHost,
  backgroundAgentHosts,
  projectTabs,
}: {
  flushRecovery: UseRecoveryCoordinatorResult["flushNow"];
  synchronizeExternalCommit: DocumentControllerState["synchronizeExternalCommit"];
  agentPlanning: BrowserAgentHostState["agentPlanning"];
  browserAgentHost: BrowserAgentHost;
  simulationTransport: AgentProjectResourcesOptions["simulationTransport"];
  projectSwitchBlockerRef: AgentProjectResourcesOptions["projectSwitchBlockerRef"];
  openProjectInTabRef: AgentProjectResourcesOptions["openProjectInTabRef"];
  setAgentFileCandidate: AgentProjectResources["setAgentFileCandidate"];
  agentProjectResources: AgentProjectResources["agentProjectResources"];
  browserAgentFileHost: BrowserAgentFileHost;
  browserAgentSimulationHost: BrowserAgentSimulationHost;
  agentWorkspaceRef: AgentProjectResources["agentWorkspaceRef"];
  browserAgentProjectHost: BrowserAgentProjectHost;
  backgroundAgentHosts: AgentConnection["backgroundAgentHosts"];
  projectTabs: ProjectTabSessions["projectTabs"];
}): AgentConnection["agentTargetRef"]["current"] {
  return (workspaceId) => {
    const entry = projectTabs.entries().find((item) => item.id === workspaceId);
    if (!entry) return null;
    if (workspaceId === projectTabs.activeId)
      return {
        host: browserAgentHost,
        fileHost: browserAgentFileHost,
        simulationHost: browserAgentSimulationHost,
        projectHost: browserAgentProjectHost,
      };
    const controller = entry.session.controller;
    const available = () =>
      projectTabs
        .entries()
        .some(
          (item) =>
            item.id === workspaceId && item.session.controller === controller,
        );
    const cached = backgroundAgentHosts.current.get(controller);
    if (cached?.sessionId === controller.projectSessionId) return cached;
    const committed = () => {
      const current = projectTabs
        .entries()
        .find(
          (item) =>
            item.id === workspaceId && item.session.controller === controller,
        );
      if (!current) return;
      if (workspaceId === projectTabs.activeId) {
        synchronizeExternalCommit();
        void flushRecovery();
      } else {
        current.session.dirty = true;
        current.session.unsafe = true;
        current.session.file.persistenceState = "dirty";
      }
      projectTabs.changed();
    };
    const host = new BrowserAgentHost(
      controller,
      committed,
      undefined,
      available,
      agentPlanning,
    );
    const existing = agentProjectResources.current
      .get(controller)
      ?.get(`${controller.projectSessionId}:${simulationTransport}`);
    const fileHost =
      existing?.files ??
      new BrowserAgentFileHost({
        transport: simulationTransport,
        getProjectSessionId: () =>
          available() ? controller.projectSessionId : "closed",
        getProject: () => controller.project,
        getDocument: (id) =>
          controller.project.documents.find((item) => item.id === id) ?? null,
        getResolver: () => controller.resolver,
        onApprovalRequested: setAgentFileCandidate,
        getActiveDocumentId: () => controller.document.id,
        commitProjectStructure: (next, active) =>
          host.commitProjectStructure(next, active),
        describeOpenBlocker: () => projectSwitchBlockerRef.current(),
        openProjectInNewTab: (candidate, background) =>
          openProjectInTabRef.current(
            candidate,
            DEFAULT_VIEWBOX,
            {
              source: "opened-file",
              agentEdited: true,
            },
            background,
          ),
        dispatchProjectTransaction: (request) =>
          host.dispatchProjectTransaction(request),
      });
    const history =
      existing?.history ?? new ProjectRunHistory(controller.project.id);
    history.activate();
    const simulationHost =
      existing?.simulation ??
      new BrowserAgentSimulationHost({
        runHistory: history,
        owner: "agent",
        files: fileHost.simulationFiles,
        getProjectSessionId: () =>
          available() ? controller.projectSessionId : "closed",
        getProject: () => controller.project,
        transport: simulationTransport,
      });
    const projectHost = new BrowserAgentProjectHost({
      projectTransactionOptions: EDITOR_PROJECT_TRANSACTION_OPTIONS,
      workspace: (request) => agentWorkspaceRef.current(request, workspaceId),
      // A tab in the background has nothing on show to publish.
      publishToGallery: createAgentGalleryPublisher({
        current: () => null,
        published: () => {},
      }),
      getProjectSessionId: () =>
        available() ? controller.projectSessionId : "closed",
      getProject: () => controller.project,
      getActiveDocumentId: () => controller.document.id,
      commitProjectStructure: (next, activeDocumentId) =>
        host.commitProjectStructure(next, activeDocumentId),
      dispatchProjectTransaction: (request) =>
        host.dispatchProjectTransaction(request),
    });
    const target = {
      sessionId: controller.projectSessionId,
      host,
      fileHost,
      simulationHost,
      projectHost,
    };
    backgroundAgentHosts.current.set(controller, target);
    if (!existing) {
      let group = agentProjectResources.current.get(controller);
      if (!group) {
        group = new Map();
        agentProjectResources.current.set(controller, group);
      }
      group.set(`${controller.projectSessionId}:${simulationTransport}`, {
        files: fileHost,
        history,
        simulation: simulationHost,
      });
    }
    return target;
  };
}
