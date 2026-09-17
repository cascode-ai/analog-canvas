// Node-only subpath (`@icm/agent-adapter/loopback`). The authenticated loopback
// adapter binds to 127.0.0.1/::1 and is used by desktop/scripted hosts only. It
// is deliberately excluded from the browser-safe main entry. See docs/specs/web-agent-session.md.

export * from "./http.js";
