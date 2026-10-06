# Snoopy golden machine

The reproducible recipe for one paid Snoopy user's dedicated VM: a small Ubuntu/Debian
box (target: 2 vCPU / 4 GB) running exactly ONE Hermes profile — `snoopy` — whose only
tool surface is the remote Snoopy MCP server plus safe web tools. This recipe is what
becomes the Boat snapshot.

```
┌──────────────────────────── 2 vCPU / 4 GB VM ────────────────────────────┐
│  hermes-gateway.service (systemd --user, always-on, multiplexes cron)    │
│       └── ticks profiles/snoopy cron jobs on schedule                  │
│  hermes -p snoopy  (one profile, one machine — no multiplexing config)   │
│       ├── model:   OpenAI-compatible endpoint (abliteration.ai / stub)   │
│       └── tools:   mcp__snoopy__* (17 tools) + web_search/web_extract    │
└─────────────────────────────────────────────────────────────────────────┘
            │ Bearer SNOOPY_MCP_TOKEN          │ Bearer ABLITERATION_API_KEY
            ▼                                  ▼
   SNOOPY_MCP_URL (per-user)          SNOOPY_MODEL_BASE_URL
```

## 1. OS dependencies (Debian/Ubuntu)

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates tar
```

`install.sh` provisions its own Python/Node — nothing else needed from the OS.

## 2. Install Hermes

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"   # installer prints the exact line
hermes --version
```

## 3. Install the snoopy profile

```bash
sudo mkdir -p /opt/snoopy && sudo chown "$USER" /opt/snoopy
git clone --depth 1 https://github.com/product-studio-private/hermes-agent /opt/snoopy/repo
hermes profile install /opt/snoopy/repo/profiles/snoopy --name snoopy --alias
```

`--alias` adds a `snoopy` wrapper to PATH (`snoopy chat` = `hermes -p snoopy chat`).

## 4. Configure secrets

```bash
cp ~/.hermes/profiles/snoopy/.env.EXAMPLE ~/.hermes/profiles/snoopy/.env
${EDITOR:-vi} ~/.hermes/profiles/snoopy/.env
```

| Var | Purpose |
|---|---|
| `SNOOPY_MCP_URL` | Per-user MCP endpoint, e.g. `https://<snoopy-worker>/mcp` |
| `SNOOPY_MCP_TOKEN` | Per-user bearer token (`snoopy_key_...`) |
| `SNOOPY_MODEL` | Model id at the inference endpoint |
| `SNOOPY_MODEL_BASE_URL` | `https://api.abliteration.ai/v1` (default) or stub URL |
| `ABLITERATION_API_KEY` | Endpoint key; any non-empty value works against a stub |
| `TAVILY_API_KEY` | optional — web_search provider key |

The config reads these via `${VAR}` interpolation + `model.key_env`; an unset
`SNOOPY_MCP_URL` fails loudly at connect time (fail closed).

## 5. Always-on daemon

```bash
hermes gateway install   # writes+enables the systemd --user unit (handles linger)
hermes gateway start
hermes gateway status
```

The host gateway multiplexes every profile under `~/.hermes/profiles/` — on this
box that's just `snoopy`. It carries the cron scheduler; enable the shipped
(paused-by-default) feed loop:

```bash
hermes -p snoopy cron list
hermes -p snoopy cron resume feed-scan   # 15-min X feed catch-up
```

## 6. Verify

```bash
hermes -p snoopy chat -q "check the feed" --oneshot   # should call a snoopy_* tool
```

## Updating the profile

```bash
git -C /opt/snoopy/repo pull
hermes profile update snoopy          # config.yaml preserved; .env untouched
hermes profile update snoopy --force-config   # only when the dist's config changed on purpose
```

Hermes itself self-updates (`hermes update`); the fork only carries
`profiles/snoopy/` + `scripts/` + this doc — zero core diffs to rebase.

## Snapshot notes (Boat)

Bake the image **after** steps 1–3 (OS deps, hermes install, profile installed)
but **before** writing real secrets: the snapshot carries
`.env.EXAMPLE`, never `.env`. Per-user values (`SNOOPY_MCP_URL`,
`SNOOPY_MCP_TOKEN`, optionally a stub `SNOOPY_MODEL_BASE_URL`) are injected at
first boot — write `~/.hermes/profiles/snoopy/.env` in the provisioning step,
then `systemctl --user start hermes-gateway` (or `hermes gateway start`).

Do not bake `state.db`, `sessions/`, `memories/`, or `logs/` — they're
per-user runtime state (the distribution .gitignore already excludes them).

## Measured footprint (macOS arm64 dev box, Oct 2026)

| Metric | Value |
|---|---|
| `hermes chat -q` turn, peak RSS | ~250 MB |
| Host gateway daemon, idle RSS | ~302 MB |
| Host gateway, idle CPU | ~0.1% |
| MCP `tools/call` server-side handling | 0.09 ms (loopback stub) |
| MCP `tools/call` client RTT (loopback curl) | <10 ms |
| Full scripted turn wall time | ~3.3 s |

A 2 vCPU / 4 GB box fits comfortably: ~0.3 GB resident daemon + ~0.25 GB burst per
turn leaves >3 GB headroom. CPU is idle-bound between cron ticks.

## What this does NOT do

- No multi-tenant gateway, no multiplexing config — one profile per VM.
- No terminal/file/browser/code-exec toolsets — enforced in `config.yaml`
  (`platform_toolsets` allowlist + `agent.disabled_toolsets`), not by prompt.
- No abliteration credits required for validation: `SNOOPY_MODEL_BASE_URL`
  points at any OpenAI-compatible stub; `scripts/mock-openai-server.mjs` is one.
- The `mcp.json` convention used by portable Agent Plugins is NOT consumed for
  plain profiles — MCP wiring lives in `config.yaml`'s `mcp_servers:` (that's
  the native mechanism; a shipped `mcp.json` would be dead config).

## Local validation

```bash
scripts/validate-golden.sh            # install + stub MCP + mock model + 1 turn + metrics
scripts/validate-golden.sh --keep     # keep the installed profile + workdir for inspection
```

Prints `PASS`/`FAIL`; evidence is the stub's JSONL request log (server-side proof
the `snoopy_*` tool call arrived) plus the mock's request log (proof of exactly
which tools the model was offered).
