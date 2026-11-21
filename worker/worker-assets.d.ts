// wrangler.jsonc bundles a .wasm import as a compiled module.
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
