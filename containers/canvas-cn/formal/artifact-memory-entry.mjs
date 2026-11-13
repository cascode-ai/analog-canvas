import entry from "./object-entry.js";
import { collectRegionalGarbage } from "./memory.mjs";

export default {
  fetch(request, env, context) {
    collectRegionalGarbage();
    return entry.fetch(request, env, context);
  },
};
