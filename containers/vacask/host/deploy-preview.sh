#!/usr/bin/env bash
# Invoked by the existing authenticated host workflow. Preview-only names are
# fixed here: none of the shared ngspice directories, tunnels or tokens change.
set -euo pipefail
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$CANDIDATE_ASSETS" =~ ^vacask-preview-assets-[A-Za-z0-9-]+$ ]]
[[ "$CANDIDATE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$CONFIG_SHA256" =~ ^[0-9a-f]{64}$ ]]
mkdir candidate-download
gh release download "$CANDIDATE_ASSETS" --dir candidate-download \
  --pattern vacask-candidate-source.tgz --pattern native-compose-config.json
printf '%s  %s\n' "$CANDIDATE_SHA256" candidate-download/vacask-candidate-source.tgz \
  "$CONFIG_SHA256" candidate-download/native-compose-config.json | sha256sum -c -
release="analog-canvas-vacask-preview/releases/$GITHUB_SHA"
ssh sim "mkdir -p ~/$release/context"
scp candidate-download/vacask-candidate-source.tgz "sim:$release/context.tgz"
scp candidate-download/native-compose-config.json "sim:$release/runtime.json"
tar -cf - containers/vacask/Dockerfile containers/vacask/host/compose.yaml containers/ngspice/gateway.mjs | ssh sim "tar -xf - -C ~/$release"
ssh sim "test \$(awk '/MemAvailable:/ {print \$2}' /proc/meminfo) -gt 1572864 && test \$(df -Pk ~ | awk 'NR==2 {print \$4}') -gt 3145728"
ssh sim "tar -xzf ~/$release/context.tgz -C ~/$release/context && docker build --platform linux/amd64 -f ~/$release/containers/vacask/Dockerfile -t icm-vacask-preview:$GITHUB_SHA ~/$release/context"

# Cloudflare API replies containing secrets never reach stdout or artifacts.
base=https://api.cloudflare.com/client/v4
auth=(-H "Authorization: Bearer $CLOUDFLARE_TUNNEL_API_TOKEN" -H 'content-type: application/json')
account="${CLOUDFLARE_ACCOUNT_ID:-$(curl -fsS "${auth[@]}" "$base/accounts?per_page=2" | jq -er 'if (.result|length)==1 then .result[0].id else error("ambiguous account") end')}"
name=analog-canvas-vacask-preview
host=vacask-preview-sim.tokenzhang.com
existing=$(curl -fsS "${auth[@]}" "$base/accounts/$account/cfd_tunnel?name=$name&is_deleted=false")
tunnel=$(printf '%s' "$existing" | jq -er 'if (.result|length)>1 then error("ambiguous tunnel") else .result[0].id // "" end')
if [ -z "$tunnel" ]; then
  tunnel=$(curl -fsS "${auth[@]}" -X POST "$base/accounts/$account/cfd_tunnel" \
    --data "$(jq -cn --arg name "$name" '{name:$name,config_src:"cloudflare"}')" | jq -er '.result.id')
fi
curl -fsS "${auth[@]}" -X PUT "$base/accounts/$account/cfd_tunnel/$tunnel/configurations" \
  --data "$(jq -cn --arg host "$host" '{config:{ingress:[{hostname:$host,service:"http://gateway:8080"},{service:"http_status:404"}]}}')" | jq -e '.success' >/dev/null
zone=$(curl -fsS "${auth[@]}" "$base/zones?name=tokenzhang.com" | jq -er '.result[0].id')
records=$(curl -fsS "${auth[@]}" "$base/zones/$zone/dns_records?name=$host")
count=$(printf '%s' "$records" | jq -r '.result|length')
if [ "$count" = 0 ]; then
  curl -fsS "${auth[@]}" -X POST "$base/zones/$zone/dns_records" \
    --data "$(jq -cn --arg name "$host" --arg content "$tunnel.cfargotunnel.com" '{type:"CNAME",name:$name,content:$content,proxied:true,ttl:1}')" | jq -e '.success' >/dev/null
else
  # Do not overwrite an unrelated existing DNS record.
  printf '%s' "$records" | jq -e --arg target "$tunnel.cfargotunnel.com" '(.result|length)==1 and .result[0].type=="CNAME" and .result[0].content==$target' >/dev/null
fi
tunnel_token=$(curl -fsS "${auth[@]}" "$base/accounts/$account/cfd_tunnel/$tunnel/token" | jq -er '.result')
access_token=$(openssl rand -hex 32)
echo "::add-mask::$tunnel_token"
echo "::add-mask::$access_token"
absolute_release=$(ssh sim "realpath ~/$release")
{
  printf 'VACASK_IMAGE=icm-vacask-preview:%s\n' "$GITHUB_SHA"
  printf 'VACASK_RUNTIME_CONFIG=%s/runtime.json\n' "$absolute_release"
  printf 'VACASK_GATEWAY_PORT=19090\nSIMULATION_ACCESS_TOKEN=%s\nVACASK_TUNNEL_TOKEN=%s\n' "$access_token" "$tunnel_token"
} | ssh sim "umask 077; cat > ~/$release/candidate.env"
ssh sim "docker compose -p icm-vacask-preview --env-file ~/$release/candidate.env -f ~/$release/containers/vacask/host/compose.yaml --profile tunnel up -d"
for attempt in $(seq 1 18); do
  if curl -fsS --max-time 10 "https://$host/health" > candidate-download/health.json; then break; fi
  sleep 5
done
jq -e '.status=="ready" and .environment.simulator.name=="vacask" and .environment.reproducibility=="pinned"' candidate-download/health.json >/dev/null
expected=$(jq -r '.runtime.expectedEnvironment.fingerprint' candidate-download/native-compose-config.json)
jq -e --arg expected "$expected" '.environment.fingerprint==$expected' candidate-download/health.json >/dev/null
[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X POST "https://$host/run")" = 401 ]
# The gateway owns one rotating bearer. Only Production is hosted; the retired
# Preview Worker stays dormant and receives no further credential mutations.
jq -cn --arg text "$access_token" '{name:"VACASK_UPSTREAM_TOKEN",type:"secret_text",text:$text}' | \
  curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'content-type: application/json' \
  -X PUT "$base/accounts/$account/workers/scripts/interactive-circuit-maker/secrets" --data-binary @- | jq -e '.success' >/dev/null
ssh sim "docker image inspect icm-vacask-preview:$GITHUB_SHA --format '{{.Id}}'"
echo "Native executor candidate ready for Production at https://$host; shared ngspice untouched."
