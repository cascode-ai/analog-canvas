/** ngspice-46 built for WebAssembly by scripts/build-ngspice-wasm.sh. */
import type { NgspiceModule } from "../ngspice-batch";

export default function createNgspice(options: {
  print(line: string): void;
  printErr(line: string): void;
  instantiateWasm(
    imports: WebAssembly.Imports,
    done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
  ): object;
}): Promise<NgspiceModule>;
