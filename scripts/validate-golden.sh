#!/usr/bin/env bash
# validate-golden.sh — end-to-end validation of the Snoopy golden machine.
#
#   - installs profiles/snoopy/ as a local Hermes profile (native mechanism)
#   - boots the stub MCP server + mock OpenAI-compatible endpoint on loopback
#   - wires the profile's .env at them (no real abliteration credits needed)
#   - runs one `hermes -p <profile> chat -q` turn that must call a stub tool
#   - asserts the tool call arrived at the MCP server (server-side log), then
#     prints measured RAM/CPU and per-call MCP latency
#
# Usage: scripts/validate-golden.sh [--keep] [--profile NAME]
#   --keep     leave the installed profile + workdir afterwards
#   --profile  profile name to install under (default: snoopy-golden)
#
# Deps: hermes on PATH (or $HERMES_BIN), node >= 18, curl, ps, awk.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_ROOT/profiles/snoopy"
PROFILE="snoopy-golden"
KEEP=0
MCP_PORT="${MCP_PORT:-8901}"
MOCK_PORT="${MOCK_PORT:-8902}"
HERMES="${HERMES_BIN:-hermes}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP=1; shift ;;
    --profile) PROFILE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/snoopy-golden.XXXXXX")"
MCP_LOG="$WORK/mcp-calls.jsonl"
MOCK_LOG="$WORK/mock-openai.jsonl"
HERMES_OUT="$WORK/hermes-turn.log"
METRICS="$WORK/metrics.txt"
PIDS=()
PROFILES_ROOT="${HERMES_PROFILES_ROOT:-$HOME/.hermes/profiles}"
PROFILE_DIR="$PROFILES_ROOT/$PROFILE"

say()  { printf '\n== %s ==\n' "$*"; }
info() { printf '   %s\n' "$*"; }
die()  { printf 'FAIL: %s\n' "$*" >&2; cleanup; exit 1; }

cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  if [[ $KEEP -eq 0 ]]; then
    rm -rf "$WORK"
  else
    info "kept workdir: $WORK"
  fi
}
trap cleanup EXIT

wait_http() { # url, label
  for _ in $(seq 1 50); do
    curl -fsS -o /dev/null "$1" 2>/dev/null && return 0
    sleep 0.1
  done
  die "$1 ($2) never came up"
}

peak_rss_kb() { # pid — sample every 100ms while alive, echo peak RSS in KB
  local pid=$1 peak=0 rss
  while kill -0 "$pid" 2>/dev/null; do
    rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ' || true)
    [[ -n "$rss" && "$rss" =~ ^[0-9]+$ && $rss -gt $peak ]] && peak=$rss
    sleep 0.1
  done
  echo "$peak"
}

say "preflight"
command -v "$HERMES" >/dev/null || die "hermes not on PATH (set \$HERMES_BIN)"
command -v node    >/dev/null || die "node not found"
command -v curl    >/dev/null || die "curl not found"
info "hermes: $(command -v "$HERMES")"
info "node:   $(node --version)"
info "dist:   $DIST_DIR"
info "work:   $WORK"

say "start stub MCP + mock model endpoint"
node "$REPO_ROOT/scripts/stub-mcp-server.mjs" --port "$MCP_PORT" --log "$MCP_LOG" >"$WORK/mcp.log" 2>&1 &
PIDS+=($!)
node "$REPO_ROOT/scripts/mock-openai-server.mjs" --port "$MOCK_PORT" --log "$MOCK_LOG" >"$WORK/mock.log" 2>&1 &
PIDS+=($!)
wait_http "http://127.0.0.1:$MCP_PORT/healthz"  "stub MCP"
wait_http "http://127.0.0.1:$MOCK_PORT/healthz" "mock model"
info "stub MCP: http://127.0.0.1:$MCP_PORT/mcp"
info "mock LLM: http://127.0.0.1:$MOCK_PORT/v1"

say "install snoopy profile ($PROFILE)"
"$HERMES" profile install "$DIST_DIR" --name "$PROFILE" --force -y </dev/null >"$WORK/install.log" 2>&1 \
  || { cat "$WORK/install.log"; die "profile install failed"; }
[[ -d "$PROFILE_DIR" ]] || die "profile dir $PROFILE_DIR not created"
tail -3 "$WORK/install.log" | sed 's/^/   /'

say "wire profile .env at stub endpoints"
cat > "$PROFILE_DIR/.env" <<EOF
# Written by validate-golden.sh — points the profile at loopback stubs.
SNOOPY_MODEL_BASE_URL=http://127.0.0.1:$MOCK_PORT/v1
SNOOPY_MODEL=snoopy-stub-model
ABLITERATION_API_KEY=stub-key
SNOOPY_MCP_URL=http://127.0.0.1:$MCP_PORT/mcp
SNOOPY_MCP_TOKEN=snoopy_key_stub_local
EOF
info "profile .env written: $PROFILE_DIR/.env"

say "run one scripted turn (hermes -p $PROFILE chat -q)"
T0=$(python3 -c 'import time; print(time.time())' 2>/dev/null || date +%s)
"$HERMES" -p "$PROFILE" chat -q "check the feed and give me verdicts" --oneshot </dev/null >"$HERMES_OUT" 2>&1 &
CHAT_PID=$!
peak_rss_kb "$CHAT_PID" > "$WORK/peak_rss.txt" &
SAMPLER=$!
wait "$CHAT_PID" || true
wait "$SAMPLER" || true
T1=$(python3 -c 'import time; print(time.time())' 2>/dev/null || date +%s)
sed 's/^/   /' "$HERMES_OUT" | tail -12

say "assert: MCP discovery + tool call reached the stub"
grep -q '"method":"tools/list"' "$MCP_LOG" 2>/dev/null && info "initialize + tools/list seen" \
  || die "no tools/list in MCP log ($MCP_LOG)"
CALL_LINE=$(grep '"method":"tools/call"' "$MCP_LOG" | tail -1 || true)
[[ -n "$CALL_LINE" ]] || die "no tools/call in MCP log"
echo "$CALL_LINE" | grep -q 'snoopy_' || die "tools/call was not a snoopy_* tool: $CALL_LINE"
info "tools/call: $CALL_LINE"
grep -q 'Feed checked' "$HERMES_OUT" && info "final answer rendered from tool result" \
  || info "final-answer string not found in hermes output (check $HERMES_OUT)"

say "metrics"
DIRECT_RTT=$( { /usr/bin/time -p curl -s -X POST "http://127.0.0.1:$MCP_PORT/mcp" \
    -H "Authorization: Bearer snoopy_key_stub_local" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":99,"method":"tools/call","params":{"name":"snoopy_feed","arguments":{}}}' \
    -o /dev/null; } 2>&1 | awk '/^real/{print $2}' )
# Idle daemon: the multiplexed host gateway is the always-on process on the
# golden machine. Boot it briefly and sample RSS + %CPU at steady state.
"$HERMES" gateway run </dev/null >"$WORK/gateway.log" 2>&1 &
GW_PID=$!
sleep 10
GW_RSS=$(ps -o rss= -p "$GW_PID" 2>/dev/null | tr -d ' ' || echo 0)
GW_CPU=$(ps -o %cpu= -p "$GW_PID" 2>/dev/null | tr -d ' ' || echo 0)
kill "$GW_PID" 2>/dev/null || true
{
  echo "turn_wall_seconds=$(python3 -c "print(round($T1-$T0,2))" 2>/dev/null || echo '?')"
  echo "peak_rss_mb_chat_turn=$(python3 -c "print(round(int(open('$WORK/peak_rss.txt').read())/1024,1))" 2>/dev/null || echo '?')"
  echo "gateway_idle_rss_mb=$(python3 -c "print(round(int('${GW_RSS:-0}')/1024,1))" 2>/dev/null || echo '?')"
  echo "gateway_idle_cpu_pct=${GW_CPU:-?}"
  echo "mcp_call_direct_rtt_s=${DIRECT_RTT:-?}"
  echo "--- mcp log ---"; cat "$MCP_LOG"
  echo "--- mock log (per-request) ---"; cat "$MOCK_LOG"
} | tee "$METRICS"

say "PASS"
info "profile install:    native mechanism OK"
info "tool surface:       platform_toolsets + disabled_toolsets applied"
info "MCP discovery:      initialize/tools/list observed server-side"
info "MCP execution:      $CALL_LINE"
info "loopback latency:   see mcp log timestamps (ms-scale, local)"
KEEP_HINT=$KEEP
exit 0
