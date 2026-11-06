import { AgentSessionDO } from "./agent-session";
import { ComponentLibraryDO } from "./component-library";
import { sqliteState } from "./gallery.test-support";
import { AnalyticsDO } from "../apps/editor/analytics/worker";

/** Actual local stores; the asset service is the external static-file boundary. */
export function regionalRuntimeBindings() {
  const components = new ComponentLibraryDO(sqliteState());
  const analytics = new AnalyticsDO(sqliteState());
  const agents = new Map<string, AgentSessionDO>();
  return {
    ANALYTICS: {
      getByName: () => ({
        fetch: (url: string, init?: RequestInit) =>
          analytics.fetch(new Request(url, init)),
      }),
    },
    ANALYTICS_KEY: undefined,
    ASSETS: {
      fetch: async () =>
        new Response(
          '<html><head><title>Canvas trial</title></head><body><div id="root"></div></body></html>',
          { headers: { "content-type": "text/html" } },
        ),
    },
    COMPONENT_LIBRARY: {
      getByName: () => ({
        fetch: (url: string, init?: RequestInit) =>
          components.fetch(new Request(url, init)),
      }),
    },
    AGENT_SESSION: {
      getByName(name: string) {
        let agent = agents.get(name);
        if (!agent) {
          const values = new Map<string, unknown>();
          agent = new AgentSessionDO(
            {
              storage: {
                get: async <T>(key: string) => values.get(key) as T | undefined,
                put: async <T>(key: string, value: T) => {
                  values.set(key, structuredClone(value));
                },
                deleteAll: async () => {
                  values.clear();
                },
                setAlarm: async () => {},
              },
            },
            {},
          );
          agents.set(name, agent);
        }
        return {
          fetch: (url: Request | string, init?: RequestInit) =>
            agent!.fetch(new Request(url, init)),
        };
      },
    },
  };
}
