# ngspice with the Sky130 device models, and nothing else.
#
# Size is the design constraint, not thrift: Cloudflare Containers cold-start
# in proportion to image size, and a simulation the author is waiting on pays
# that start every time a sleeping container wakes. The full Sky130
# distribution is 2.1 GB; the files ngspice actually reads are 52 MB — 4 MB of
# corner and parameter decks under libs.tech/ngspice, plus 48 MB of device
# model cards under libs.ref/sky130_fd_pr/spice. The remainder is GDS, LEF,
# and Magic layout that no circuit simulator opens, so it never enters the
# image.
#
# The build takes the PDK from a volare-style checkout supplied as a build
# context path, rather than downloading 2.1 GB during every build.

FROM debian:bookworm-slim AS models

ARG SKY130_ROOT=pdk/sky130A
COPY ${SKY130_ROOT}/libs.tech/ngspice /stage/sky130A/libs.tech/ngspice
COPY ${SKY130_ROOT}/libs.ref/sky130_fd_pr /stage/sky130A/libs.ref/sky130_fd_pr

# Layout data is the 2 GB the simulator never reads. Dropping it here keeps
# the copied tree out of the final image's layers entirely.
RUN find /stage/sky130A/libs.ref/sky130_fd_pr \
        -mindepth 1 -maxdepth 1 -type d ! -name spice -exec rm -rf {} + \
    && find /stage -type f \
        ! -name '*.spice' ! -name '*.lib' ! -name '*.lib.spice' \
        ! -name '*.mod' ! -name '*.model' ! -name '*.pm3' -delete \
    && du -sh /stage

FROM debian:bookworm-slim

# ngspice from Debian: a packaged build tracks upstream fixes and is far
# smaller than a source build with its toolchain.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ngspice \
    && rm -rf /var/lib/apt/lists/*

COPY --from=models /stage/sky130A /opt/sky130/sky130A

# Where the run harness resolves `.lib` paths from. The models are read-only
# and identical for every run; nothing about a run is written here.
ENV SKY130_MODEL_ROOT=/opt/sky130/sky130A \
    NGSPICE_BIN=/usr/bin/ngspice

# A container wakes with a fresh disk, so the run directory is scratch by
# nature. Declaring it here documents that nothing survives a sleep.
WORKDIR /run/simulation

COPY entrypoint.mjs /opt/harness/entrypoint.mjs
RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 8080
CMD ["node", "/opt/harness/entrypoint.mjs"]
