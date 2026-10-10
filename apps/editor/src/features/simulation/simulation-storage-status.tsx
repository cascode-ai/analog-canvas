import { useEffect, useState } from "react";
import type { SimulationFiles } from "@icm/simulation-service/files";
import type { EvidenceResourceUsage } from "@icm/simulation-service/contract";
import { subscribeEvidenceChanges } from "./browser-simulation-storage-lock";

const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
export function SimulationStorageStatus({
  files,
  projectId,
  revision,
}: {
  files: SimulationFiles;
  projectId: string;
  revision: string;
}) {
  const [usage, setUsage] = useState<EvidenceResourceUsage>();
  const [changed, setChanged] = useState(0);
  useEffect(
    () =>
      subscribeEvidenceChanges(projectId, () =>
        setChanged((value) => value + 1),
      ),
    [projectId],
  );
  useEffect(() => {
    let disposed = false;
    void files.resourceUsage().then(
      (value) => {
        if (!disposed) setUsage(value);
      },
      () => {
        if (!disposed) setUsage(undefined);
      },
    );
    return () => {
      disposed = true;
    };
  }, [files, projectId, revision, changed]);
  if (!usage) return <p>Result storage usage unavailable.</p>;
  return (
    <details aria-label="Result storage">
      <summary>
        Project result storage · {mib(usage.usedBytes)} / {mib(usage.byteLimit)}
      </summary>
      <p>
        {usage.fileCount} / {usage.fileLimit} files ·{" "}
        {mib(usage.protectedBytes)} protected · {mib(usage.reclaimableBytes)}{" "}
        reclaimable
      </p>
      {usage.reservedBytes > 0 ? (
        <p>{mib(usage.reservedBytes)} reserved for writes.</p>
      ) : null}
      {usage.pendingReclaimBytes > 0 ? (
        <p>{mib(usage.pendingReclaimBytes)} pending physical cleanup.</p>
      ) : null}
      {usage.logicalBytes !== undefined &&
      usage.logicalBytes !== usage.usedBytes ? (
        <p>Original file size: {mib(usage.logicalBytes)}</p>
      ) : null}
      {usage.blockers?.includes("legacy-project-consumer") ? (
        <p>
          An older Editor window is protecting this project. Update or close
          that window to allow cleanup.
        </p>
      ) : null}
      {usage.blockers?.includes("coordination-unavailable") ? (
        <p>This browser cannot coordinate cleanup between windows.</p>
      ) : null}
      {usage.blockers
        ?.filter((item) => item.startsWith("in-use:"))
        .map((item) => (
          <p key={item}>
            Run {item.slice("in-use:".length)} is being viewed in an Editor
            window.
          </p>
        ))}
      {usage.originQuota ? (
        <p>
          Browser origin storage estimate:{" "}
          {usage.originQuota.usage === undefined
            ? "unavailable"
            : mib(usage.originQuota.usage)}{" "}
          /{" "}
          {usage.originQuota.quota === undefined
            ? "unavailable"
            : mib(usage.originQuota.quota)}
          . Includes other projects and browser overhead.
        </p>
      ) : null}
    </details>
  );
}
