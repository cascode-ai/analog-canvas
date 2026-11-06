using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "login", worker = (
      compatibilityDate = "2026-08-11",
      modules = [
        (name = "entry.mjs", esModule = embed "entry.mjs"),
        (name = "worker/index.js", esModule = embed "worker/index.js"),
        (name = "page.html", text = embed "page.html")
      ],
      bindings = [
        (name = "AUTH", durableObjectNamespace = "AuthDO"),
        (name = "GH_OAUTH_CLIENT_ID", text = embed "/github-client-id"),
        (name = "GH_OAUTH_CLIENT_SECRET", text = embed "/github-client-secret"),
        (name = "RESEND_API_KEY", text = embed "/resend-key"),
        (name = "AUTH_EMAIL_FROM", text = embed "/email-from")
      ],
      durableObjectNamespaces = [
        (className = "AuthDO", uniqueKey = "canvas-cn-login-probe-AuthDO", enableSql = true)
      ],
      durableObjectStorage = (localDisk = "state"),
      globalOutbound = "provider-egress"
    )),
    (name = "state", disk = (path = "/var/lib/analog-canvas-login/state", writable = true)),
    (name = "provider-egress", worker = (
      compatibilityDate = "2026-08-11",
      modules = [(name = "egress.mjs", esModule = embed "egress.mjs")],
      globalOutbound = "internet"
    )),
    (name = "internet", network = (allow = ["public"], tlsOptions = (trustBrowserCas = true)))
  ],
  sockets = [(name = "http", address = "127.0.0.1:8791", http = (), service = "login")]
);
