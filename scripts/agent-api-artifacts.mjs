import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  agentCircuitRequestJsonSchema,
  agentCircuitResponseJsonSchema,
  agentCircuitOpenApi,
} from "../packages/agent-adapter/dist/index.js";

const artifacts = new Map([
  ["agent-circuit-request.schema.json", agentCircuitRequestJsonSchema()],
  ["agent-circuit-response.schema.json", agentCircuitResponseJsonSchema()],
  ["agent-circuit.openapi.json", agentCircuitOpenApi],
]);
const check = process.argv.includes("--check");
for (const [name, value] of artifacts) {
  const path = resolve(process.cwd(), "fixtures/agent-api", name);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    if (readFileSync(path, "utf8") !== text) {
      throw new Error(`${name} is stale`);
    }
  } else {
    writeFileSync(path, text, "utf8");
  }
}
console.log(
  `${check ? "Validated" : "Wrote"} ${artifacts.size} Agent API artifacts`,
);
