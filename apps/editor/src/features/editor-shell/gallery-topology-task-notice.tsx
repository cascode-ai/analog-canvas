import { useSyncExternalStore } from "react";
import { galleryTopologyTask } from "./gallery-topology-task";
import "./gallery-topology-task-notice.css";

export function GalleryTopologyTaskNotice({
  hidden,
  onOpen,
}: {
  hidden: boolean;
  onOpen: () => void;
}) {
  const task = useSyncExternalStore(
    galleryTopologyTask.subscribe,
    galleryTopologyTask.getSnapshot,
    galleryTopologyTask.getSnapshot,
  );
  if (hidden || !task.snapshot || task.noticeDismissed) return null;
  return (
    <aside
      className="gallery-topology-task-notice"
      data-testid="gallery-topology-task-notice"
      aria-label="Duplicate check task"
    >
      <span role="status">
        {task.running
          ? `Checking “${task.snapshot.name}”… ${task.report?.scanned ?? 0} compared`
          : task.failure || task.report?.error || task.report?.sourceError
            ? "Duplicate check needs attention"
            : task.report?.complete
              ? `Duplicate check finished · ${task.report.matches.length} results`
              : "Duplicate check cancelled"}
      </span>
      <button type="button" onClick={onOpen}>
        {task.running ? "View progress" : "View results"}
      </button>
      {!task.running ? (
        <button
          type="button"
          aria-label="Dismiss duplicate check notification"
          onClick={galleryTopologyTask.dismissNotice}
        >
          ×
        </button>
      ) : null}
    </aside>
  );
}
