# Build ONLY with the exclusive context produced by package-vacask-image.mjs.
# This image is a candidate, not a qualified Profile or a deployment.
FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS node-runtime
FROM ubuntu:24.04@sha256:224a1869083a311ef3f13648a154ba79832fbef6364d31493642ca03082da254
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
# Bootstrap TLS from the digest-pinned Node trust store; keep apt signature checks.
RUN mkdir -p /etc/ssl/certs \
    && node -e "require('fs').writeFileSync('/etc/ssl/certs/ca-certificates.crt', require('tls').rootCertificates.join('\n') + '\n')"
COPY ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources
RUN test "$(uname -m)" = x86_64 \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       python3 binutils libgomp1 libfftw3-double3 libklu2 libopenblas0-pthread \
    && mkdir -p /opt /var/lib/vacask \
    && dpkg-query -W > /opt/os-packages.txt \
    && rm -rf /var/lib/apt/lists/*
COPY vacask/ /opt/vacask/
COPY modules/ /opt/modules/
COPY model-source/ /opt/model-source/
COPY models/ /opt/models/
COPY harness/ /opt/harness/
COPY SHA256SUMS /opt/SHA256SUMS
COPY startup.toml /opt/startup.toml
WORKDIR /opt
RUN sha256sum -c SHA256SUMS \
    && chmod 755 /opt/vacask/bin/vacask /opt/vacask/bin/openvaf-r \
    && node --version \
    && /opt/vacask/bin/openvaf-r /opt/vacask/src/vacask/devices/resistor.va -o /tmp/build-probe.osdi \
    && test -s /tmp/build-probe.osdi \
    && rm /tmp/build-probe.osdi \
    && chown 10001:10001 /var/lib/vacask \
    && chmod 700 /var/lib/vacask \
    && chmod -R a-w /opt
USER 10001:10001
WORKDIR /var/lib/vacask
ENTRYPOINT ["node", "/opt/harness/vacask-harness.mjs"]
# Operator-owned read-only config must supply a pinned measured environment for
# hosted-container. No credentials in this process; retain the separate gateway.
CMD ["/etc/vacask/runtime-config.json"]
