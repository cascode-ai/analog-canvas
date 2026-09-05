// Browser-safe entry. These modules never import `node:http`, `node:crypto`, or
// Node `Buffer`, so the editor (WP-WA3) can import them directly. The Node-only
// loopback transport lives in `./loopback.ts` and the `./loopback` subpath.

export * from "./envelope.js";
export { planEnsureNamedNet } from "@icm/edit-engine";
export * from "./file-resource.js";
export * from "./host.js";
export * from "./mcp-distribution.js";
export * from "./openapi.js";
export * from "./platform.js";
export * from "./request-contract.js";
export * from "./schema.js";
export * from "./service.js";
export * from "./session-state.js";
export * from "./simulation-resource.js";
export * from "./snapshot.js";
