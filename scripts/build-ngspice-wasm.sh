#!/usr/bin/env bash
# Build ngspice-46 as a batch-mode WebAssembly module for the editor's
# in-browser SKY130 runs (docs/specs/simulation-execution.md).
#
#   scripts/build-ngspice-wasm.sh [WORK_DIR] [OUT_DIR]
#
# Needs git, curl, make, a C toolchain for configure's build checks and
# Python >= 3.10 for emsdk (EMSDK_PYTHON picks one). Build on a Linux host,
# not a laptop: it compiles the whole simulator. OUT_DIR receives
# ngspice.mjs, ngspice.wasm, spinit and ngspice-COPYING.txt; copy them to
# apps/editor/src/features/simulation/browser-ngspice/vendor/ (ngspice's
# COPYING to apps/editor/public/third-party/ngspice-COPYING.txt) and record
# the wasm digest as browser.simulator.binarySha256 in
# containers/ngspice/hosted-sky130-profile.json.
set -euo pipefail

EMSDK_VERSION=3.1.74
# ngspice-46's release time: the binary embeds its build date, so a fixed
# one makes the build reproducible byte for byte.
export SOURCE_DATE_EPOCH=1774793340
NGSPICE_URL=https://downloads.sourceforge.net/project/ngspice/ng-spice-rework/old-releases/46/ngspice-46.tar.gz
NGSPICE_SHA256=a0d1699af1940b06649276dcd6ff5a566c8c0cad01b2f7b5e99dedbb4d64c19b
WORK_DIR=$(mkdir -p "${1:-$HOME/wasm}" && cd "${1:-$HOME/wasm}" && pwd)
OUT_DIR=$(mkdir -p "${2:-$WORK_DIR/out}" && cd "${2:-$WORK_DIR/out}" && pwd)

cd "$WORK_DIR"
[ -d emsdk ] || git clone --depth 1 https://github.com/emscripten-core/emsdk.git
(cd emsdk && ./emsdk install "$EMSDK_VERSION" && ./emsdk activate "$EMSDK_VERSION")
# shellcheck disable=SC1091
source emsdk/emsdk_env.sh

[ -f ngspice-46.tar.gz ] || curl -fsSL -o ngspice-46.tar.gz "$NGSPICE_URL"
echo "$NGSPICE_SHA256  ngspice-46.tar.gz" | sha256sum -c -
rm -rf ngspice-46 && tar xzf ngspice-46.tar.gz
mkdir -p ngspice-46/release && cd ngspice-46/release

# Batch mode only: no XSPICE code models, OSDI, CIDER, OpenMP or readline.
# The module is instantiated once per run (EXIT_RUNTIME) and driven through
# callMain with the deck in Emscripten's in-memory FS.
emconfigure ../configure --host=wasm32-unknown-emscripten \
  --disable-debug --disable-openmp --with-x=no --without-readline \
  --disable-xspice --disable-osdi --enable-cider=no \
  CFLAGS="-O2" \
  LDFLAGS="-sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=8MB -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createNgspice -sFORCE_FILESYSTEM=1 -sEXIT_RUNTIME=1 -sINVOKE_RUN=0 -sENVIRONMENT=web,worker,node -sEXPORTED_RUNTIME_METHODS=callMain,FS"
emmake make -j"${JOBS:-$(nproc)}"

# The loader is generated code: the repository's lint leaves it alone.
{
  printf '%s\n' "/* oxlint-disable -- Emscripten's generated loader (scripts/build-ngspice-wasm.sh), vendored as built. */"
  cat src/ngspice
} > "$OUT_DIR/ngspice.mjs"
cp src/ngspice.wasm "$OUT_DIR/ngspice.wasm"
cp src/spinit "$OUT_DIR/spinit"
cp ../COPYING "$OUT_DIR/ngspice-COPYING.txt"
sha256sum "$OUT_DIR"/ngspice.mjs "$OUT_DIR"/ngspice.wasm "$OUT_DIR"/spinit
