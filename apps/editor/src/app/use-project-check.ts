import { useEffect, useRef, useState } from "react";
import type { ProjectConnectivityIndex } from "@icm/derived";
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
}: {
  project: CircuitProject;
  sessionId: string;
  resolver: SymbolResolver;
  index: ProjectConnectivityIndex;
  save(candidate: CircuitProject): Promise<CloudProjectSaveOutcome>;
  isSaving(): boolean;
  openIssues(): void;
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
    // Save captures this immutable candidate before its first await. Checking
    // is independent of the Cloud outcome, including offline and signed out.
    const pendingSave = save(project);
    try {
      // Yield once so the command's busy state can paint before a large check.
      // This is an explicit operation, never a background edit subscription.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (latestSession.current === sessionId) {
        setResult(runProjectCheck(project, identity, index));
        setChecking(false);
      }
      await pendingSave;
    } finally {
      inFlight.current = false;
      setBusy(false);
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
