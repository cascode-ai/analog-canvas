#!/usr/bin/env node
// Generates the China runtime's workerd configuration and scheduled timer from
// wrangler.jsonc (the single source) and containers/canvas-cn/formal/region.jsonc
// (the region's declared differences). `--check` fails when a committed file is
// stale or a Production binding is neither carried nor excluded with a reason.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const FORMAL = "containers/canvas-cn/formal";
export const GENERATED = {
  config: `${FORMAL}/config.capnp`,
  timer: `${FORMAL}/canvas-cn-scheduled.timer`,
  service: `${FORMAL}/canvas-cn-formal.service`,
};
const OPERATOR_HOST = (name) => `https://${name}.canvas-operator.invalid`;
/** Credentials the egress service reads besides the Worker's own. */
const EGRESS_CREDENTIALS = ["peer-origin", "identity-url"];

/** JSON with comments and trailing commas, as wrangler accepts. */
export function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
      if (i === 0) throw new Error("Unterminated comment");
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** `*\/N * * * *` only: anything richer must be added deliberately. */
export function calendarOf(cron) {
  const match = /^\*\/([1-9][0-9]?) \* \* \* \*$/.exec(cron);
  if (!match || 60 % Number(match[1]) !== 0)
    throw new Error(`Unsupported cron for the regional timer: ${cron}`);
  return `*-*-* *:00/${match[1]}:00`;
}

const quote = (value) => JSON.stringify(String(value));

/** Every Production key the region must account for. */
export function classify(wrangler, region) {
  const problems = [];
  const excluded = region.excluded ?? {};
  for (const [key, reason] of Object.entries(excluded))
    if (typeof reason !== "string" || reason.length < 10)
      problems.push(`excluded ${key} needs a reason`);
  const known = new Set([
    "$schema",
    "name",
    "main",
    "compatibility_date",
    "vars",
    "assets",
    "services",
    "ratelimits",
    "durable_objects",
    "r2_buckets",
    "triggers",
    "queues",
  ]);
  for (const key of Object.keys(wrangler))
    if (!known.has(key) && !(key in excluded))
      problems.push(`wrangler.jsonc ${key} is not carried or excluded`);
  for (const service of wrangler.services ?? [])
    if (!(`services.${service.binding}` in excluded))
      problems.push(`service ${service.binding} is not carried or excluded`);
  for (const producer of wrangler.queues?.producers ?? [])
    if (!(`queues.${producer.binding}` in excluded))
      problems.push(`queue ${producer.binding} is not carried or excluded`);
  for (const binding of wrangler.durable_objects?.bindings ?? []) {
    const ns = region.namespaces?.[binding.name];
    if (!ns) problems.push(`Durable Object ${binding.name} has no namespace`);
    else if (ns.class !== binding.class_name && !ns.reason)
      problems.push(
        `Durable Object ${binding.name} changes class without a reason`,
      );
  }
  for (const bucket of wrangler.r2_buckets ?? [])
    if (!region.buckets?.[bucket.binding])
      problems.push(`R2 bucket ${bucket.binding} has no regional storage`);
  for (const [name, operator] of Object.entries(region.upstreams ?? {})) {
    if (!(name in (wrangler.vars ?? {})))
      problems.push(`upstream ${name} is not a Production variable`);
    if (!region.operators?.[operator])
      problems.push(`upstream ${name} names unknown operator ${operator}`);
  }
  for (const limit of wrangler.ratelimits ?? [])
    if (!limit.simple?.limit || !limit.simple?.period)
      problems.push(`rate limit ${limit.name} is not a simple limit`);
  const regionNames = [
    ...Object.keys(region.text ?? {}),
    ...Object.keys(region.aliases ?? {}),
    ...Object.keys(region.credentials ?? {}),
  ];
  for (const name of regionNames)
    if (name in (wrangler.vars ?? {}))
      problems.push(`${name} shadows a Production variable; declare it there`);
  for (const cron of wrangler.triggers?.crons ?? []) {
    try {
      calendarOf(cron);
    } catch (error) {
      problems.push(error.message);
    }
  }
  return problems;
}

export function operatorRoutes(wrangler, region) {
  const routes = {};
  for (const [name, operator] of Object.entries(region.upstreams)) {
    const path = new URL(wrangler.vars[name]).pathname.replace(/\/$/, "");
    (routes[operator] ??= new Set()).add(path);
  }
  return Object.entries(region.operators).map(([name]) => ({
    name,
    origin: OPERATOR_HOST(name),
    binding: `${name.toUpperCase()}_OPERATOR`,
    prefixes: [...(routes[name] ?? [""])].sort(),
  }));
}

export function renderConfig(wrangler, region) {
  const bindings = [];
  const add = (line) => bindings.push(`        ${line}`);
  for (const binding of wrangler.durable_objects.bindings)
    add(
      `(name = ${quote(binding.name)}, durableObjectNamespace = ${quote(region.namespaces[binding.name].class)}),`,
    );
  for (const [name, className] of Object.entries(region.aliases ?? {}))
    add(
      `(name = ${quote(name)}, durableObjectNamespace = ${quote(className)}),`,
    );
  for (const bucket of wrangler.r2_buckets ?? [])
    add(
      `(name = ${quote(bucket.binding)}, r2Bucket = ${quote(region.buckets[bucket.binding])}),`,
    );
  add(`(name = "ASSETS", service = "assets"),`);
  for (const [name, value] of Object.entries(wrangler.vars ?? {})) {
    const operator = region.upstreams?.[name];
    const text = operator
      ? `${OPERATOR_HOST(operator)}${new URL(value).pathname.replace(/\/$/, "")}`
      : value;
    add(`(name = ${quote(name)}, text = ${quote(text)}),`);
  }
  const limits = Object.fromEntries(
    (wrangler.ratelimits ?? []).map((l) => [l.name, l.simple]),
  );
  add(
    `(name = "REGIONAL_RATE_LIMITS", text = ${quote(JSON.stringify(limits))}),`,
  );
  for (const [name, value] of Object.entries(region.text ?? {}))
    add(`(name = ${quote(name)}, text = ${quote(value)}),`);
  for (const [name, file] of Object.entries(region.credentials ?? {}))
    add(`(name = ${quote(name)}, text = embed ${quote(`/${file}`)}),`);
  bindings[bindings.length - 1] = bindings.at(-1).replace(/,$/, "");

  const classes = [
    ...new Map(
      Object.values(region.namespaces).map((ns) => [ns.class, ns.key]),
    ),
  ];
  const namespaces = classes.map(
    ([className, key], i) =>
      `        (className = ${quote(className)}, uniqueKey = ${quote(key)}, enableSql = true)${i < classes.length - 1 ? "," : ""}`,
  );
  const routes = operatorRoutes(wrangler, region);
  const operatorServices = Object.entries(region.operators).map(
    ([name, operator]) =>
      `    (name = ${quote(`${name}-operator`)}, external = (address = ${quote(operator.address)}, http = ())),`,
  );
  return `# Generated by scripts/regional-runtime.mjs from wrangler.jsonc and
# region.jsonc. Do not edit; run \`node scripts/regional-runtime.mjs\`.
using Workerd = import "/workerd/workerd.capnp";
using Artifacts = import "artifact-storage.capnp";

const config :Workerd.Config = (
  extensions = Artifacts.extensions,
  services = [
    (name = "canvas", worker = (
      compatibilityDate = ${quote(wrangler.compatibility_date)},
      modules = [(name = "index.js", esModule = embed "worker/index.js")],
      bindings = [
${bindings.join("\n")}
      ],
      durableObjectNamespaces = [
${namespaces.join("\n")}
      ],
      durableObjectStorage = (localDisk = "state"),
      globalOutbound = "regional-egress"
    )),
    (name = "state", disk = (path = ${quote(region.state)}, writable = true)),
    (name = "assets", external = (address = ${quote(region.assets)}, http = ())),
    (name = "artifact-entry", worker = Artifacts.entry),
    (name = "artifact-store", worker = Artifacts.bucket),
    (name = "artifact-state", disk = (path = ${quote(region.artifactState)}, writable = true)),
    (name = "deny-outbound", worker = (
      compatibilityDate = ${quote(wrangler.compatibility_date)},
      modules = [(name = "deny.js", esModule = "export default {fetch(){return new Response('Outbound request refused',{status:403});}}")]
    )),
    (name = "regional-egress", worker = (
      compatibilityDate = ${quote(wrangler.compatibility_date)},
      modules = [(name = "egress.mjs", esModule = embed "egress.mjs")],
      bindings = [
        (name = "PEER_ORIGIN", text = embed "/peer-origin"),
        (name = "IDENTITY_URL", text = embed "/identity-url"),
        (name = "OPERATORS", text = ${quote(JSON.stringify(routes))}),
${routes.map((r, i) => `        (name = ${quote(r.binding)}, service = ${quote(`${r.name}-operator`)})${i < routes.length - 1 ? "," : ""}`).join("\n")}
      ],
      globalOutbound = "internet"
    )),
${operatorServices.join("\n")}
    (name = "internet", network = (allow = ["public"], tlsOptions = (trustBrowserCas = true)))
  ],
  sockets = [(name = "http", address = ${quote(region.listen)}, http = (), service = "canvas")]
);
`;
}

export function renderTimer(wrangler) {
  const calendars = (wrangler.triggers?.crons ?? []).map(calendarOf);
  return `# Generated by scripts/regional-runtime.mjs from wrangler.jsonc triggers.
[Unit]
Description=Run Production's scheduled Canvas work in the regional runtime

[Timer]
${calendars.map((c) => `OnCalendar=${c}`).join("\n")}
AccuracySec=1s
Persistent=true
Unit=canvas-cn-scheduled.service

[Install]
WantedBy=timers.target
`;
}

export function renderService(template, region) {
  const files = [
    ...new Set([...Object.values(region.credentials), ...EGRESS_CREDENTIALS]),
  ].sort();
  const lines = files.map(
    (file) => `LoadCredential=${file}:/etc/analog-canvas-formal/${file}`,
  );
  const block =
    /# BEGIN generated credentials\n[\s\S]*?# END generated credentials\n/;
  if (!block.test(template))
    throw new Error(
      "canvas-cn-formal.service lacks the generated credential block",
    );
  return template.replace(
    block,
    `# BEGIN generated credentials\n${lines.join("\n")}\n# END generated credentials\n`,
  );
}

export async function generate(base = root) {
  const read = (path) => readFile(join(base, path), "utf8");
  const wrangler = parseJsonc(await read("wrangler.jsonc"));
  const region = parseJsonc(await read(`${FORMAL}/region.jsonc`));
  const problems = classify(wrangler, region);
  if (problems.length)
    throw new Error(`Regional runtime parity:\n- ${problems.join("\n- ")}`);
  return {
    [GENERATED.config]: renderConfig(wrangler, region),
    [GENERATED.timer]: renderTimer(wrangler),
    [GENERATED.service]: renderService(await read(GENERATED.service), region),
  };
}

async function main() {
  const check = process.argv.includes("--check");
  const files = await generate();
  const stale = [];
  for (const [path, text] of Object.entries(files)) {
    const target = join(root, path);
    const current = await readFile(target, "utf8").catch(() => "");
    if (current === text) continue;
    if (check) stale.push(path);
    else await writeFile(target, text);
  }
  if (stale.length) {
    console.error(
      `Stale regional runtime files (run node scripts/regional-runtime.mjs):\n${stale.join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    check
      ? "Regional runtime files are current."
      : "Regional runtime files written.",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  await main();
