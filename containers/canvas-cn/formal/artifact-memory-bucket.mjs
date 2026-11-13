import { R2BucketObject as Bucket } from "./bucket.js";
import { collectRegionalGarbage } from "./memory.mjs";

export class R2BucketObject extends Bucket {
  fetch(request) {
    collectRegionalGarbage();
    return super.fetch(request);
  }
}
