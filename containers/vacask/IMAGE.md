# Local native image candidate

This image composes the existing VACASK runtime bundle; it introduces no second
executor or Profile protocol. It is not yet a hosted, qualified environment.

Package explicit, locally prepared artifacts into a **new** directory:

```sh
node scripts/package-vacask-image.mjs <new-context> <linux-release> <repaired-build> <model-package> <harness-package>
docker build --platform linux/amd64 -t icm-vacask:candidate <new-context>
```

The packager checks the accepted Linux simulator and repaired BSIM4 module
identities, validates model and harness manifest hashes, and emits asset
checksums verified during the build. Base images use OCI digests, Ubuntu
packages use a dated snapshot, and `/opt/os-packages.txt` records installed
versions. These are build inputs, not a promise of bit-identical image rebuilds.
Record the actual image digest and existing runtime environment fingerprint.

`<repaired-build>` is the directory emitted by `vacask-bsim4-build.mjs`, containing
`modules/`, `bsim4v8.va` and `build.json`. Packaging verifies the corresponding
source, original source, compiler and module against the build record. The image
contains the repaired source and portable recipe in `/opt/model-source/`; local
absolute paths and compile logs are not published. From `/opt`, use the compiler
and `rebuildArgs` recorded there to write a new module into writable scratch.
Rebuilding does not overwrite the accepted module or qualify a new digest.

The image runs as UID 10001. Supply the existing runtime configuration at
`/etc/vacask/runtime-config.json` read-only; hosted mode still requires the
independently pinned expected environment. No credentials or deployment
configuration are baked into this candidate.

## Native process smoke

Prepare a read-only proof directory containing:

- `inputs.json`: an array of actual public Prepare inputs for the five model
  sections, each exercising OP, DC, AC, TRAN and Noise;
- `image-smoke.mjs`: this directory's script;
- `native-example-acceptance.mjs`: the existing helper from `scripts/lib/`.

Use a fresh writable evidence directory. The smoke records exact inputs,
results and environment, verifies complete finite native results and executed
files, and checks scratch cleanup after stopping the service.

It then injects a syntax error, an intentionally long native transient run,
concurrent admission, active cancellation and a 100 ms deadline. Each failure
must release its lease and scratch before a subsequent five-analysis run can
succeed. The busy request must return 429, not start a parallel simulator. These
are executor lifecycle tests, not a distributed queue or forced-host-restart test.

```sh
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --memory 1g --cpus 1 --pids-limit 128 \
  --tmpfs /var/lib/vacask:rw,exec,nosuid,nodev,size=268435456,uid=10001,gid=10001,mode=0700 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=67108864 \
  --mount type=bind,source=<absolute-proof-directory>,target=/proof,readonly \
  --mount type=bind,source=<absolute-new-evidence-directory>,target=/evidence \
  --entrypoint node icm-vacask:candidate /proof/image-smoke.mjs
```

The private job tmpfs must permit executable mappings: OpenVAF-generated OSDI
modules are shared libraries loaded from the job directory. `noexec` there
prevents native behavioral probes from running. OpenVAF also requires a linker;
the image installs binutils and checks that a real compilation produces an OSDI
file, because the packaged compiler can report a linker failure with exit zero.

This local proof uses observed `local-host` identity inside Docker, not hosted
qualification. It does not certify hostile-job isolation, admission/queue
behavior, forced-stop recovery, cloud routing or latency. Before distribution,
review third-party licensing; local inputs are not downloaded by this recipe.
No shared Preview, production route or operator service is changed here.
