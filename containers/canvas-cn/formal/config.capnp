using Workerd = import "/workerd/workerd.capnp";
using Artifacts = import "artifact-storage.capnp";

# Separate from both the synthetic editor trial and disposable provider probe.
const config :Workerd.Config = (
  extensions = Artifacts.extensions,
  services = [
    (name = "canvas", worker = (
      compatibilityDate = "2026-08-11",
      modules = [(name = "index.js", esModule = embed "worker/index.js")],
      bindings = [
        (name = "AUTH", durableObjectNamespace = "RegionalSessionDO"),
        (name = "GALLERY", durableObjectNamespace = "GalleryDO"),
        (name = "PROJECTS", durableObjectNamespace = "GalleryDO"),
        (name = "PROJECTS_STORE_NAME", text = "gallery"),
        (name = "COMPONENT_LIBRARY", durableObjectNamespace = "ComponentLibraryDO"),
        (name = "AGENT_SESSION", durableObjectNamespace = "AgentSessionDO"),
        (name = "SIMULATION_CONTROL", durableObjectNamespace = "SimulationControlDO"),
        (name = "TOPOLOGY_TASK", durableObjectNamespace = "TopologyTaskDO"),
        (name = "ANALYTICS", durableObjectNamespace = "AnalyticsDO"),
        (name = "SIMULATION_ARTIFACTS", r2Bucket = "artifact-entry"),
        (name = "SIMULATION_DISPATCH", text = "alarm"),
        (name = "SIMULATION_SMOKE_TOKEN", text = embed "/simulation-smoke-token"),
        (name = "SIMULATION_UPSTREAM_URL", text = "https://ngspice.canvas-operator.invalid"),
        (name = "SIMULATION_UPSTREAM_TOKEN", text = embed "/operator-token"),
        (name = "SIMULATION_DEFAULT_EXECUTOR", text = "operator-host"),
        (name = "VACASK_PROFILE_ID", text = "vacask-sky130-candidate"),
        (name = "VACASK_UPSTREAM_URL", text = "https://vacask.canvas-operator.invalid"),
        (name = "VACASK_UPSTREAM_TOKEN", text = embed "/operator-token"),
        (name = "ASSETS", service = "assets"),
        (name = "PROJECT_REGION", text = "cn"),
        (name = "PROJECT_REGION_USERS", text = embed "/project-region-users.json"),
        (name = "PROJECT_PROTECTED_IDS", text = embed "/project-protected-ids.json"),
        (name = "PROJECT_WRITES_ENABLED", text = "false"),
        (name = "PROJECT_SYNC_PULL", text = "true"),
        (name = "PROJECT_SYNC_MAX_BYTES", text = "1073741824"),
        (name = "AUTH_REGIONAL_CLIENT", text = embed "/regional-client.json"),
        (name = "PROJECT_SYNC_TOKEN", text = embed "/sync-inbound-token"),
        (name = "PROJECT_SYNC_PEER_URL", text = embed "/peer-origin"),
        (name = "PROJECT_SYNC_PEER_TOKEN", text = embed "/sync-outbound-token"),
        (name = "PROJECT_SYNC_ADMIN_TOKEN", text = embed "/sync-admin-token"),
        (name = "PROJECT_IDENTITY_URL", text = embed "/identity-url"),
        (name = "PROJECT_IDENTITY_TOKEN", text = embed "/identity-token")
      ],
      durableObjectNamespaces = [
        (className = "RegionalSessionDO", uniqueKey = "canvas-cn-formal-session-v1", enableSql = true),
        (className = "GalleryDO", uniqueKey = "canvas-cn-formal-gallery-v1", enableSql = true),
        (className = "ComponentLibraryDO", uniqueKey = "canvas-cn-formal-components-v1", enableSql = true),
        (className = "AgentSessionDO", uniqueKey = "canvas-cn-formal-agent-v1", enableSql = true),
        (className = "SimulationControlDO", uniqueKey = "canvas-cn-formal-simulation-v1", enableSql = true),
        (className = "TopologyTaskDO", uniqueKey = "canvas-cn-formal-topology-v1", enableSql = true),
        (className = "AnalyticsDO", uniqueKey = "canvas-cn-formal-analytics-v1", enableSql = true)
      ],
      durableObjectStorage = (localDisk = "state"),
      globalOutbound = "regional-egress"
    )),
    (name = "state", disk = (path = "/var/lib/analog-canvas-formal/state", writable = true)),
    (name = "assets", external = (address = "127.0.0.1:8083", http = ())),
    (name = "artifact-entry", worker = Artifacts.entry),
    (name = "artifact-store", worker = Artifacts.bucket),
    (name = "artifact-state", disk = (path = "/var/lib/analog-canvas-formal/artifacts", writable = true)),
    (name = "deny-outbound", worker = (
      compatibilityDate = "2026-08-11",
      modules = [(name = "deny.js", esModule = "export default {fetch(){return new Response('Outbound request refused',{status:403});}}")]
    )),
    (name = "regional-egress", worker = (
      compatibilityDate = "2026-08-11",
      modules = [(name = "egress.mjs", esModule = embed "egress.mjs")],
      bindings = [
        (name = "PEER_ORIGIN", text = embed "/peer-origin"),
        (name = "IDENTITY_URL", text = embed "/identity-url"),
        (name = "NGSPICE_OPERATOR", service = "ngspice-operator"),
        (name = "VACASK_OPERATOR", service = "vacask-operator")
      ],
      globalOutbound = "internet"
    )),
    (name = "ngspice-operator", external = (address = "127.0.0.1:19094", http = ())),
    (name = "vacask-operator", external = (address = "127.0.0.1:19095", http = ())),
    (name = "internet", network = (allow = ["public"], tlsOptions = (trustBrowserCas = true)))
  ],
  sockets = [(name = "http", address = "127.0.0.1:8792", http = (), service = "canvas")]
);
