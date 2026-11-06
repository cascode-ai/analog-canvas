using Workerd = import "/workerd/workerd.capnp";

# Separate from both the synthetic editor trial and disposable provider probe.
const config :Workerd.Config = (
  services = [
    (name = "canvas", worker = (
      compatibilityDate = "2026-08-11",
      modules = [(name = "index.js", esModule = embed "worker/index.js")],
      bindings = [
        (name = "AUTH", durableObjectNamespace = "RegionalSessionDO"),
        (name = "GALLERY", durableObjectNamespace = "GalleryDO"),
        (name = "PROJECTS", durableObjectNamespace = "RegionalProjectDO"),
        (name = "PROJECT_REGION", text = "cn"),
        (name = "PROJECT_WRITES_ENABLED", text = "false"),
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
        (className = "RegionalProjectDO", uniqueKey = "canvas-cn-formal-projects-v1", enableSql = true)
      ],
      durableObjectStorage = (localDisk = "state"),
      globalOutbound = "regional-egress"
    )),
    (name = "state", disk = (path = "/var/lib/analog-canvas-formal/state", writable = true)),
    (name = "regional-egress", worker = (
      compatibilityDate = "2026-08-11",
      modules = [(name = "egress.mjs", esModule = embed "egress.mjs")],
      bindings = [
        (name = "PEER_ORIGIN", text = embed "/peer-origin"),
        (name = "IDENTITY_URL", text = embed "/identity-url")
      ],
      globalOutbound = "internet"
    )),
    (name = "internet", network = (allow = ["public"], tlsOptions = (trustBrowserCas = true)))
  ],
  sockets = [(name = "http", address = "127.0.0.1:8792", http = (), service = "canvas")]
);
