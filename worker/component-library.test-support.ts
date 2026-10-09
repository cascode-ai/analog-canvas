import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";
import { builtInSymbols } from "@icm/symbols";
import type { CircuitComponentPackage } from "@icm/edit-engine";
import {
  ComponentLibraryDO,
  routeComponentLibraryRequest,
  type ComponentLibraryEnv,
} from "./component-library";

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
export function componentLibraryHarness() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  const durable = new ComponentLibraryDO({
    storage: {
      sql: {
        exec<T>(sql: string, ...bindings: (string | number | null)[]) {
          const statement = db.prepare(sql);
          if (sql.trim().startsWith("SELECT"))
            return { toArray: () => statement.all(...bindings) as T[] };
          statement.run(...bindings);
          return { toArray: () => [] as T[] };
        },
      },
      transactionSync<T>(fn: () => T): T {
        db.exec("BEGIN");
        try {
          const result = fn();
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    },
  });
  const env: ComponentLibraryEnv = {
    COMPONENT_LIBRARY: {
      getByName: () => ({
        fetch: (input, init) => durable.fetch(new Request(input, init)),
      }),
    },
    AUTH: {
      getByName: () => ({
        fetch: async (input, init) => {
          const request =
            typeof input === "string" ? new Request(input, init) : input;
          const id = request.headers.get("cookie")?.split("=")[1];
          return Response.json({
            user: id
              ? {
                  id,
                  displayName: id,
                  isAdmin: id === "admin",
                  role: id === "moderator" ? "moderator" : "user",
                }
              : null,
          });
        },
      }),
    },
  };
  const route = (
    method = "GET",
    suffix = "",
    body?: unknown,
    user?: string,
    origin = "https://components.test",
  ) =>
    routeComponentLibraryRequest(
      new Request(`https://components.test/api/components${suffix}`, {
        method,
        headers: { origin, ...(user ? { cookie: `icm_session=${user}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    ) as Promise<Response>;
  return Object.assign(route, { durable });
}
export function nativePackage(): CircuitComponentPackage {
  return {
    definition: {
      symbol: {
        ...structuredClone(
          builtInSymbols.find((item) => item.id === "resistor")!,
        ),
        id: "package-resistor",
        name: "Packaged resistor",
      },
      circuitBinding: {
        definitionId: "native-resistor",
        terminals: [
          { terminalId: "p", pinName: "1" },
          { terminalId: "n", pinName: "2" },
        ],
      },
    },
    circuit: {
      version: 1,
      externalDefinition: {
        id: "native-resistor",
        name: "pkg_resistor",
        terminals: [
          { id: "p", name: "P", direction: "passive" },
          { id: "n", name: "N", direction: "passive" },
        ],
        formalParameters: [{ name: "value", defaultValue: "1k" }],
        interfaceStatus: "declared",
        symbolId: "package-resistor",
        implementation: {
          kind: "source",
          sourceId: "source-resistor",
          entry: "pkg_resistor",
        },
      },
      source: {
        id: "source-resistor",
        revision: 1,
        language: "spice",
        entry: "model.spice",
        files: [
          {
            path: "model.spice",
            text: '.include "helper.spice"\n.include "vendor/models.spice"\n.subckt pkg_resistor P N params: value=1k\nR1 P N {value}\n.ends pkg_resistor\n',
          },
          {
            path: "helper.spice",
            text: ".subckt helper A B\nR1 A B 1k\n.ends helper\n",
          },
        ],
        dependencies: [
          {
            id: "vendor-models",
            mountPath: "vendor/models.spice",
            sha256: "a".repeat(64),
          },
        ],
      },
    },
  };
}
