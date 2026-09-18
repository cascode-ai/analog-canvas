import { scanGalleryDuplicates } from "./gallery-duplicates";

// Terminating this dedicated worker cancels both computation and in-flight reads.
self.onmessage = () => {
  void scanGalleryDuplicates((report) => self.postMessage(report));
};
