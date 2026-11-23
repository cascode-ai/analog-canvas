import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Fired only in a separately built diagnostic editor. Inclusive times may nest.
function installRecorder() {
  let sample;
  const recorder = {
    reset() {
      sample = { calls: {}, inclusiveMs: {}, counts: {} };
    },
    read() {
      const result = sample;
      sample = undefined;
      return result;
    },
    start(name) {
      const target = sample;
      if (!target) return;
      target.calls[name] = (target.calls[name] ?? 0) + 1;
      return performance.now();
    },
    finish(name, start) {
      if (start === undefined || !sample) return;
      sample.inclusiveMs[name] =
        (sample.inclusiveMs[name] ?? 0) + (performance.now() - start);
    },
    count(name, value = 1) {
      if (sample) sample.counts[name] = (sample.counts[name] ?? 0) + value;
    },
    check(name, failed) {
      if (failed) recorder.count(name);
      return failed;
    },
    measure(name, run) {
      const start = recorder.start(name);
      try {
        return run();
      } finally {
        recorder.finish(name, start);
      }
    },
  };
  globalThis.scalingEditDiagnostics = recorder;
}

const modules = {
  "routing-operation-plan": [
    "gateRoutingOperationPlan",
    "validateExpectedEffect",
  ],
  "prepared-transaction": [
    "prepareTransaction",
    "reusePreparedTransaction",
    "executionContextKey",
  ],
  transaction: ["executeTransaction"],
  "transaction-routing": ["validateRoute"],
  "transaction-connectivity-rebuild": ["rebuildEditedConnectivity"],
  "electrical-topology-projection": ["deriveElectricalTopologyProjection"],
  "connectivity-index": ["buildProjectConnectivityIndex"],
  "resolved-route-geometry": ["resolveDocumentRoutingGeometry"],
  "document-controller": ["record", "restoreHistory"],
};

function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      for (const item of child) walk(item, visit);
    } else {
      walk(child, visit);
    }
  }
}

const probe = "globalThis.scalingEditDiagnostics";

function diagnosticPlugin() {
  const seen = new Set();
  return {
    name: "edit-benchmark-diagnostics",
    enforce: "post",
    transform(code, id) {
      const match = id
        .replaceAll("\\", "/")
        .match(
          /\/(?:packages\/(?:edit-engine|derived)\/(?:src|dist)|apps\/editor\/src\/document)\/([^/]+)\.[jt]s$/,
        );
      const names =
        match && Object.hasOwn(modules, match[1]) && modules[match[1]];
      if (!names) return;
      const insertions = [];
      const insert = (at, value) => insertions.push([at, value]);
      const wrap = (node, prefix, suffix) => {
        insert(node.start, prefix);
        insert(node.end, suffix);
      };
      walk(this.parse(code), (node) => {
        const name = node.id?.name ?? node.key?.name;
        const body =
          node.type === "FunctionDeclaration"
            ? node.body
            : node.type === "MethodDefinition"
              ? node.value?.body
              : undefined;
        if (body && names.includes(name)) {
          seen.add(name);
          const label = JSON.stringify(name);
          insert(
            body.start + 1,
            `const probeStart = ${probe}.start(${label});try{`,
          );
          insert(
            body.end - 1,
            `}finally{${probe}.finish(${label},probeStart);}`,
          );
        }
        if (match[1] === "prepared-transaction") {
          if (
            node.type === "CallExpression" &&
            node.callee.object?.name === "JSON" &&
            node.callee.property?.name === "stringify"
          ) {
            const input = node.arguments[0];
            const label =
              input?.name === "document"
                ? "serialize.document"
                : input?.object?.name === "transaction" &&
                    input.property?.name === "edits"
                  ? "serialize.edits"
                  : undefined;
            if (label) wrap(node, `${probe}.measure("${label}",()=>`, ")");
          }
          if (node.type === "BinaryExpression" && node.operator === "!==") {
            const owner = node.left.object?.name;
            if (owner === "token" || owner === "preparation") {
              wrap(
                node,
                `${probe}.check("mismatch.${node.left.property.name}",`,
                ")",
              );
            }
          }
          if (
            node.type === "VariableDeclaration" &&
            node.declarations.some(
              (d) =>
                d.id.name === "result" &&
                d.init?.object?.name === "preparation",
            )
          )
            insert(node.start, `${probe}.count("prepared.hit");`);
          if (
            node.type === "VariableDeclaration" &&
            node.declarations.some((d) => d.id.name === "candidates")
          ) {
            insert(
              node.end,
              `if(!candidates.length)${probe}.count("prepared.noCandidate");`,
            );
          }
        }
        if (match[1] === "transaction" && node.type === "CallExpression") {
          if (
            node.callee.object?.name === "SchematicDocumentSchema" &&
            node.callee.property?.name === "safeParse"
          ) {
            wrap(node, `${probe}.measure("validate.document",()=>`, ")");
          }
          if (
            node.callee.name === "structuredClone" &&
            node.arguments[0]?.name === "document"
          ) {
            wrap(node, `${probe}.measure("execute.draftCopy",()=>`, ")");
          }
        }
        if (
          match[1] === "transaction-connectivity-rebuild" &&
          node.type === "VariableDeclaration" &&
          node.declarations.some(
            (d) =>
              d.init?.callee?.name === "affectedConductors" &&
              d.id.name === "affected",
          )
        ) {
          insert(
            node.end,
            `${probe}.count("affected.nets",affected.netIds.size);${probe}.count("affected.endpoints",affected.endpoints.size);${probe}.count("affected.edges",affected.edges.length);`,
          );
        }
      });
      for (const [at, value] of insertions.sort((a, b) => b[0] - a[0])) {
        code = code.slice(0, at) + value + code.slice(at);
      }
      // A module can be evaluated ahead of the entry (including lazy chunks).
      return `if (!${probe}) (${installRecorder.toString()})();\n${code}`;
    },
    buildEnd(error) {
      if (error) return;
      const missing = Object.values(modules)
        .flat()
        .filter((name) => !seen.has(name));
      if (missing.length)
        this.error("Missing edit diagnostic functions: " + missing.join(", "));
    },
  };
}

export async function buildEditDiagnostics({ checkout, outDir }) {
  const editor = join(resolve(checkout), "apps/editor");
  const target = resolve(outDir);
  const marker = join(target, ".edit-benchmark-diagnostics");
  if (
    target === join(editor, "dist") ||
    (existsSync(target) && readdirSync(target).length && !existsSync(marker))
  ) {
    throw new Error("Choose a separate diagnostic output directory");
  }
  const require = createRequire(join(editor, "package.json"));
  const { build } = await import(pathToFileURL(require.resolve("vite")));
  await build({
    root: editor,
    configFile: join(editor, "vite.config.ts"),
    build: { outDir: target, emptyOutDir: false },
    define: { "import.meta.env.VITE_ICM_AGENT_UI": JSON.stringify("enabled") },
    plugins: [diagnosticPlugin()],
  });
  writeFileSync(marker, "This editor contains benchmark-only probes.\n");
}
