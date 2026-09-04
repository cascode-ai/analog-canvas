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

# The deck that runs here was written by someone who is not the operator of
# this container, and raw `.control` is permitted by the contract — isolation,
# not prohibition, is what keeps a control script inside its own job. Root is
# the wrong account to hand that to. An unprivileged one cannot write the
# simulator, the models, or the harness, and the only directory it can write
# is the scratch root that every run's private directory is made under.
#
# The guards matter because the base image is not ours: it may already carry
# this uid, and answering that with a build failure would make a base image
# swap a Dockerfile edit.
ARG RUN_UID=10001
ARG RUN_GID=10001
ARG RUN_USER=simulate
# Not under /run. A container runtime may mount its own tmpfs there, and if
# it does, the directory this image prepared and chowned is replaced by a
# root-owned one the run account cannot write — which is what took the
# preview simulator down on 2026-09-04. /var/lib is ordinary image state that
# nothing mounts over. The harness probes whatever it is given at startup and
# falls back if it has to, but the right answer is not to need the fallback.
ARG RUN_ROOT=/var/lib/simulation
RUN set -eu; \
    if ! getent group "${RUN_GID}" >/dev/null 2>&1; then \
        groupadd --system --gid "${RUN_GID}" "${RUN_USER}"; \
    fi; \
    if ! getent passwd "${RUN_UID}" >/dev/null 2>&1; then \
        useradd --system --uid "${RUN_UID}" --gid "${RUN_GID}" \
            --home-dir "${RUN_ROOT}" --shell /usr/sbin/nologin "${RUN_USER}"; \
    fi

# Where the harness finds the simulator and the model tree it fingerprints.
# The base image already sets SKY130_MODEL_LIB to the continuous library; the
# Worker selects that same path (worker/simulation.ts).
ENV NGSPICE_BIN=/opt/ngspice/bin/ngspice \
    SKY130_MODEL_ROOT=/opt/sky130

# A container wakes with a fresh disk, so the run directory is scratch by
# nature. Declaring it here documents that nothing survives a sleep.
WORKDIR ${RUN_ROOT}

# The build context is the repository root (wrangler.preview.jsonc sets
# image_build_context to "."), so every COPY is repo-root relative.
ARG HARNESS_DIR=containers/ngspice
COPY ${HARNESS_DIR}/entrypoint.mjs /opt/harness/entrypoint.mjs

# Nothing a deck can reach is writable except its own run directory.
#
# The harness is ours and small, so it is simply stripped of every write bit.
# The simulator and the model tree came with the base image and are measured
# in gigabytes: `chmod -R` over them would copy every file into a new layer
# and double the image, for a tree whose files are already root-owned. So
# only the files that are actually group- or other-writable are corrected,
# which on a well-built base is none of them and costs an empty layer. That
# the property really holds is not assumed — the container workflow asserts
# it by trying to write, as the run account, and requiring failure.
RUN set -eu; \
    chmod -R a-w /opt/harness; \
    find /opt/sky130 /opt/ngspice -perm /022 -exec chmod go-w {} + || true; \
    mkdir -p "${RUN_ROOT}"; \
    chown "${RUN_UID}:${RUN_GID}" "${RUN_ROOT}"; \
    chmod 700 "${RUN_ROOT}"

# Where the harness makes each run's private directory, and the two kernel
# limits it starts the simulator under. The limits are set here rather than
# defaulted in the harness because they only mean anything against a known
# account: RLIMIT_NPROC counts every process this uid owns, and in this image
# that is the harness and one simulator. 128 processes is far above anything
# ngspice reaches — it does not fork — and far below a fork bomb. 524288
# blocks is 256 MiB in dash's 512-byte units, a ceiling on what one `write`
# can pour onto the scratch disk; no rawfile of a schematic-sized circuit
# comes near it.
#
# RUN_ROOT is spelled once, above, and referred to from here on: an image that
# prepared one directory while the harness looked in another would fail every
# run at the first mkdtemp.
ENV SIMULATION_RUN_ROOT=${RUN_ROOT} \
    SIMULATION_MAX_PROCESSES=128 \
    SIMULATION_MAX_FILE_BLOCKS=524288 \
    HOME=${RUN_ROOT}

USER ${RUN_UID}:${RUN_GID}

EXPOSE 8080
CMD ["node", "/opt/harness/entrypoint.mjs"]
