import { build } from "vite";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

// Shared result interpretation travels with the executor, not with Worker RAM.
const output = resolve(process.argv[2] ?? "containers/ngspice/runtime");
await mkdir(output, { recursive: true });
await build({
  configFile: false,
  logLevel: "warn",
  build: {
    ssr: resolve("containers/ngspice/entrypoint.mjs"),
    outDir: output,
    emptyOutDir: false,
    target: "node18",
    minify: false,
    rollupOptions: { output: { entryFileNames: "entrypoint.mjs" } },
  },
  ssr: { noExternal: true },
});
