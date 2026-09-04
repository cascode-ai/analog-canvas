# The simulator the benchmark suite runs, plus our harness, and nothing else.
#
# The base is analog-arena's own simulator image, pinned by digest: ngspice 46
# built from source at /opt/ngspice, and the Sky130 models at /opt/sky130 in
# both forms, the binned PDK checkout and the CONTINUOUS (unbinned) library at
# /opt/sky130/continuous/sky130.lib.spice. Two reasons this replaced the slim
# Debian image built here on 2026-09-01:
#
# - The binned models cap device width at 100 µm and refused the benchmark's
#   own reference OTA (#551). The continuous library has no such ceiling and
#   is not something a volare checkout can produce.
# - Simulator and models are now byte-identical to what the benchmark runs,
#   so a numerical disagreement in the acceptance comparison can only mean
#   our export is wrong. The slim image left a second explanation (two
#   different ngspice builds) that no test could ever rule out.
#
# The digest is the environment lock. Changing it is a deliberate edit here;
# the image reports the resulting binary and model-tree hashes at runtime.
ARG BASE_IMAGE=ghcr.io/arcadia-1/circuit-bench-sky130-ngspice@sha256:2da03dc7f1ead7ddc33f2f930a0487ae8618e51518009344584a98fca41a621d
FROM ${BASE_IMAGE}

# The harness is a Node program; the base image has none. Debian bookworm's
# packaged Node is enough for it (fs, http, child_process, crypto).
RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Where the harness finds the simulator and the model tree it fingerprints.
# The base image already sets SKY130_MODEL_LIB to the continuous library; the
# Worker selects that same path (worker/simulation.ts).
ENV NGSPICE_BIN=/opt/ngspice/bin/ngspice \
    SKY130_MODEL_ROOT=/opt/sky130

# A container wakes with a fresh disk, so the run directory is scratch by
# nature. Declaring it here documents that nothing survives a sleep.
WORKDIR /run/simulation

# The build context is the repository root (wrangler.preview.jsonc sets
# image_build_context to "."), so every COPY is repo-root relative.
ARG HARNESS_DIR=containers/ngspice
COPY ${HARNESS_DIR}/entrypoint.mjs /opt/harness/entrypoint.mjs

EXPOSE 8080
CMD ["node", "/opt/harness/entrypoint.mjs"]
