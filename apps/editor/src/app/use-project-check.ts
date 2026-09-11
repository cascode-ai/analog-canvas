import { useEffect, useRef, useState } from "react";
import {
  buildProjectConnectivityIndex,
  type ProjectConnectivityIndex,
} from "@icm/derived";
import type { CircuitProject } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  projectCheckIdentity,
  projectCheckStatus,
  runProjectCheck,
  type ProjectCheckResult,
} from "./project-check";
import type { CloudProjectSaveOutcome } from "../features/editor-shell/cloud-projects";

export function useProjectCheck({
  project,
  sessionId,
  resolver,
  index,
  save,
  isSaving,
  openIssues,
  beforeCheck,
}: {
  project: CircuitProject;
  sessionId: string;
  resolver: SymbolResolver;
  index: ProjectConnectivityIndex;
  save(candidate: CircuitProject): Promise<CloudProjectSaveOutcome>;
  isSaving(): boolean;
  openIssues(): void;
  beforeCheck?(): Promise<CircuitProject | null>;
}) {
  const [result, setResult] = useState<ProjectCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);
  const identity = projectCheckIdentity(project, sessionId, resolver);
  const latestSession = useRef(sessionId);
  latestSession.current = sessionId;
  useEffect(() => {
    setResult(null);
    setChecking(false);
  }, [sessionId]);

  async function checkAndSave(): Promise<void> {
    if (inFlight.current || isSaving()) return;
    inFlight.current = true;
    setBusy(true);
    setChecking(true);
    openIssues();
    try {
      const candidate = beforeCheck ? await beforeCheck() : project;
      if (!candidate || latestSession.current !== sessionId) return;
      const candidateIndex =
        candidate === project
          ? index
          : buildProjectConnectivityIndex(candidate, resolver);
      const candidateIdentity = projectCheckIdentity(
        candidate,
        sessionId,
        resolver,
      );
      // Source buffers join the normal Project transaction before both check and save.
      const pendingSave = save(candidate);
      // Yield once so the command's busy state can paint before a large check.
      // This is an explicit operation, never a background edit subscription.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (latestSession.current === sessionId) {
        setResult(
          runProjectCheck(candidate, candidateIdentity, candidateIndex),
        );
        setChecking(false);
      }
      await pendingSave;
    } finally {
      inFlight.current = false;
      setBusy(false);
      setChecking(false);
    }
  }

  const visible = result?.identity.sessionId === sessionId ? result : null;
  return {
    result: visible,
    status: checking
      ? ("checking" as const)
      : projectCheckStatus(visible, identity),
    busy,
    checkAndSave,
  };
}
