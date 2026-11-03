ARG BASE_IMAGE=ghcr.io/arcadia-1/circuit-bench-sky130-ngspice@sha256:2da03dc7f1ead7ddc33f2f930a0487ae8618e51518009344584a98fca41a621d
FROM ${BASE_IMAGE} AS models
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
ARG IHP_REVISION=5e6d592e4002946a4616f798c357f0f3c06cf3b6
ARG OPENVAF_SHA256=9bc343d52e00529ddba452b90358cdd14da14ec7437d75dec2dbd621eda54bc8
RUN curl -fL https://fides.fe.uni-lj.si/openvaf/download/openvaf-reloaded-osdi_0.3-31-gf47d557-linux_x64.tar.gz -o openvaf.tar.gz \
    && echo "${OPENVAF_SHA256}  openvaf.tar.gz" | sha256sum -c - \
    && tar -xzf openvaf.tar.gz \
    && git init ihp && cd ihp && git remote add origin https://github.com/IHP-GmbH/IHP-Open-PDK.git \
    && git fetch --depth 1 origin ${IHP_REVISION} && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${IHP_REVISION}"
RUN mkdir -p /opt/sg13g2/osdi /opt/sg13g2/source \
    && cp -R ihp/ihp-sg13g2/libs.tech/ngspice/models /opt/sg13g2/models \
    && cp -R ihp/ihp-sg13g2/libs.tech/verilog-a /opt/sg13g2/source/ \
    && cp ihp/LICENSE /opt/sg13g2/LICENSE \
    && ./openvaf -D__NGSPICE__ --target_cpu generic -o /opt/sg13g2/osdi/psp103.osdi ihp/ihp-sg13g2/libs.tech/verilog-a/psp103/psp103.va \
    && ./openvaf -D__NGSPICE__ --target_cpu generic -o /opt/sg13g2/osdi/psp103_nqs.osdi ihp/ihp-sg13g2/libs.tech/verilog-a/psp103/psp103_nqs.va \
    && ./openvaf -D__NGSPICE__ --target_cpu generic -o /opt/sg13g2/osdi/r3_cmc.osdi ihp/ihp-sg13g2/libs.tech/verilog-a/r3_cmc/r3_cmc.va
COPY containers/ngspice/sg13g2/sg13g2.lib.spice /opt/sg13g2/sg13g2.lib.spice

# Reuse the qualified simulator binary; keep SG13 models and scratch isolated.
FROM ${BASE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/simulation && chown 10001:10001 /var/lib/simulation && chmod 700 /var/lib/simulation
COPY --from=models /opt/sg13g2 /opt/sg13g2
COPY --from=models /build/ihp/ihp-sg13g2/libs.ref/sg13g2_stdcell/spice/sg13g2_stdcell.spice /opt/sg13g2-cells/sg13g2_stdcell.spice
COPY containers/ngspice/runtime/entrypoint.mjs /opt/harness/entrypoint.mjs
COPY containers/simulation/run-local-files.mjs /opt/simulation/run-local-files.mjs
COPY containers/ngspice/sg13g2/profile.json /opt/harness/profile.json
COPY containers/ngspice/sg13g2/hosted.spiceinit /opt/harness/hosted.spiceinit
COPY containers/ngspice/sg13g2/verify-image.mjs /opt/harness/verify-image.mjs
RUN chmod -R a-w /opt/sg13g2 /opt/harness /opt/simulation /opt/sg13g2-cells
ENV NGSPICE_BIN=/opt/ngspice/bin/ngspice \
    SIMULATION_MODEL_ROOT=/opt/sg13g2 \
    SIMULATION_PROFILE_PATH=/opt/harness/profile.json \
    SIMULATION_STARTUP_PATH=/opt/harness/hosted.spiceinit \
    SIMULATION_RUN_ROOT=/var/lib/simulation \
    SIMULATION_MAX_PROCESSES=128 \
    SIMULATION_MAX_FILE_BLOCKS=524288 \
    HOME=/var/lib/simulation
USER 10001:10001
WORKDIR /var/lib/simulation
RUN node /opt/harness/verify-image.mjs
EXPOSE 8080
CMD ["node", "/opt/harness/entrypoint.mjs"]
