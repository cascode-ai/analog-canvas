/**
 * What the simulator's Worker does with each message: load ngspice and the
 * Profile's libraries once, measure them against the Profile's browser pin,
 * and run each deck with a fresh module instance. The Worker entry
 * (ngspice.worker.ts) only says where the bytes come from.
 */
import createNgspice from "./vendor/ngspice.mjs";
import {
  measureBrowserNgspice,
  ngspiceVersion,
  type BrowserNgspiceAssets,
  type BrowserNgspiceEnvironment,
} from "./browser-ngspice-environment";
import type {
  BrowserNgspiceWorkerReply,
  BrowserNgspiceWorkerRequest,
} from "./browser-ngspice-protocol";
import {
  runNgspiceBatch,
  type CreateNgspiceModule,
  type NgspiceSystem,
} from "./ngspice-batch";

/** Where the simulator's bytes come from; read once per Worker. */
export interface NgspiceWorkerAssets {
  load(): Promise<Omit<BrowserNgspiceAssets, "version"> & { spinit: string }>;
}

const SPINIT_PATH = "/usr/local/share/ngspice/scripts/spinit";

interface Loaded {
  createModule: CreateNgspiceModule;
  measured: BrowserNgspiceEnvironment;
  system: NgspiceSystem;
}

async function load(assets: NgspiceWorkerAssets): Promise<Loaded> {
  const { spinit, ...bytes } = await assets.load();
  const compiled = await WebAssembly.compile(bytes.wasm);
  const createModule: CreateNgspiceModule = (streams) =>
    createNgspice({
      ...streams,
      instantiateWasm(imports, done) {
        void WebAssembly.instantiate(compiled, imports).then((instance) =>
          done(instance, compiled),
        );
        return {};
      },
    });
  const banner: string[] = [];
  const probe = await createModule({
    print: (line) => banner.push(line),
    printErr: (line) => banner.push(line),
  });
  probe.callMain(["--version"]);
  const measured = await measureBrowserNgspice({
    ...bytes,
    version: ngspiceVersion(banner.join("\n")),
  });
  return {
    createModule,
    measured,
    system: {
      libraries: [
        { path: SPINIT_PATH, bytes: new TextEncoder().encode(spinit) },
        ...(measured.ok ? measured.libraries : []),
      ],
      startup: bytes.startup,
    },
  };
}

/** The Worker's message handler over `assets`. */
export function ngspiceWorkerHost(assets: NgspiceWorkerAssets) {
  let loading: Promise<Loaded> | undefined;
  return async (
    { id, request }: BrowserNgspiceWorkerRequest,
    reply: (message: BrowserNgspiceWorkerReply) => void,
  ) => {
    let loaded: Loaded;
    try {
      loaded = await (loading ??= load(assets));
    } catch (error) {
      loading = undefined;
      reply({
        id,
        kind: "not-ready",
        message: `The in-browser simulator could not load: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    if (!loaded.measured.ok) {
      reply({ id, kind: "not-ready", message: loaded.measured.message });
      return;
    }
    reply({ id, kind: "started", environment: loaded.measured.environment });
    try {
      const output = await runNgspiceBatch(
        loaded.createModule,
        loaded.system,
        request,
      );
      reply({ id, kind: "finished", output });
    } catch (error) {
      reply({
        id,
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
