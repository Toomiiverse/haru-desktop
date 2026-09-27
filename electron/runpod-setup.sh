#!/usr/bin/env bash
# Haru's model, on a rented GPU.
#
# Run this once inside a RunPod pod's web terminal. It installs Ollama, pulls the
# model, and puts a token check in front of it — that last part is not optional.
# A pod's HTTP proxy is a public address on the internet, and Ollama has no
# authentication of its own, so without this anyone who finds the URL can spend
# the GPU and read whatever is sent to it. That includes the whole conversation,
# her memory of you, and your calendar, because all of it travels in the prompt.
#
#   Pod settings that matter
#     Template      runpod/pytorch  (any CUDA image will do; this one is handy)
#     GPU           24GB is the comfortable floor for a 14B at 8k context
#     Expose HTTP   8080   — NOT 11434. Ollama stays on localhost inside the pod
#                            and is only reachable through the proxy below.
#     Volume        30GB at /workspace, so the model survives a stop/start
#
#   Then, on the desktop, in Setup:
#     Endpoint      https://<POD_ID>-8080.proxy.runpod.net
#     API key       whatever you set as HARU_TOKEN below
#
# Stopping the pod stops the billing for the GPU but not for the volume, and the
# model stays on the volume so restarting does not re-download 9GB.

set -euo pipefail

# Change this. It is the only thing standing between your conversation and the
# open internet, so make it long and random — `openssl rand -hex 32` is fine.
HARU_TOKEN="${HARU_TOKEN:-change-me-before-running}"
MODEL="${MODEL:-qwen2.5:14b}"

if [ "$HARU_TOKEN" = "change-me-before-running" ]; then
  echo "Set HARU_TOKEN first: export HARU_TOKEN=\$(openssl rand -hex 32)" >&2
  exit 1
fi

# Keep everything on the volume. The container filesystem is wiped on a restart;
# /workspace is not, and re-pulling the model every morning is the difference
# between a pod that costs pennies and one that costs patience.
export OLLAMA_MODELS=/workspace/ollama
mkdir -p "$OLLAMA_MODELS"

echo "== installing ollama =="
command -v ollama >/dev/null 2>&1 || curl -fsSL https://ollama.com/install.sh | sh

echo "== starting ollama on localhost only =="
# 127.0.0.1, so the only way in is through the authenticated proxy on 8080.
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_KEEP_ALIVE=24h nohup ollama serve >/workspace/ollama.log 2>&1 &
until curl -sf http://127.0.0.1:11434/api/tags >/dev/null; do sleep 1; done

echo "== pulling $MODEL (this is the slow part) =="
ollama pull "$MODEL"

echo "== installing the token check =="
apt-get update -qq && apt-get install -y -qq caddy 2>/dev/null || {
  # Caddy is not in every base image; its own repo always has it.
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
}

# Every request must carry the bearer token; anything else is refused before it
# reaches the model. RunPod terminates TLS at the proxy, so the hop from the
# desktop is https and the token is not travelling in the clear.
cat >/workspace/Caddyfile <<CADDY
:8080 {
	@authorised header Authorization "Bearer ${HARU_TOKEN}"
	handle @authorised {
		reverse_proxy 127.0.0.1:11434
	}
	handle {
		respond "no" 401
	}
}
CADDY

pkill caddy 2>/dev/null || true
nohup caddy run --config /workspace/Caddyfile >/workspace/caddy.log 2>&1 &
sleep 2

echo
echo "== check =="
echo -n "without a token (should be 401): "
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/api/tags
echo -n "with the token (should be 200):  "
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer ${HARU_TOKEN}" http://127.0.0.1:8080/api/tags
echo
echo "Endpoint for Haru:  https://<POD_ID>-8080.proxy.runpod.net"
echo "API key for Haru :  ${HARU_TOKEN}"
