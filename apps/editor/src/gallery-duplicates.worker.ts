import type { CircuitProject } from "@icm/model";
import { scanGalleryDuplicates } from "./gallery-duplicates";
import { scanGalleryTopologyMatches } from "./gallery-topology-match";

// Terminating this dedicated worker cancels both computation and in-flight reads.
self.onmessage = (
  event: MessageEvent<"scan" | { type: "topology"; project: CircuitProject }>,
) => {
  if (event.data === "scan") {
    void scanGalleryDuplicates((report) => self.postMessage(report));
    return;
  }
  void scanGalleryTopologyMatches(event.data.project, (report) =>
    self.postMessage(report),
  );
};
