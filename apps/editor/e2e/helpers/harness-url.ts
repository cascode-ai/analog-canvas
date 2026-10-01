import { pageModules } from "./page-modules.js";

/**
 * Where the page imports one of `pageModules` from: its source, when the dev
 * server runs (ICM_E2E_SERVER=dev), or the module scripts/build-e2e-editor.mjs
 * builds beside the editor otherwise.
 */
const fromSource = process.env.ICM_E2E_SERVER === "dev";

export type PageModuleName = keyof typeof pageModules;

export function harnessModuleUrl(name: PageModuleName): string {
  return fromSource ? `/${pageModules[name]}` : `/e2e-harness/${name}.js`;
}

/** A page that mounts a harness itself needs React Refresh's preamble from source. */
export const harnessPagePreamble = fromSource
  ? `import RefreshRuntime from "/@react-refresh";
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;`
  : "";
