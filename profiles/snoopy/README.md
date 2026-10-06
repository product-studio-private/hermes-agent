# snoopy — Hermes profile distribution

The golden-machine profile for Snoopy: an autonomous X-watching memecoin trader
that reads posts, forms launch/buy/skip/sell verdicts, and acts via the remote
Snoopy MCP server. One profile per machine.

## Surface

- **Model:** `provider: custom` — any OpenAI-compatible endpoint. Defaults to
  `https://api.abliteration.ai/v1`; override with `SNOOPY_MODEL_BASE_URL`.
- **Tools:** the `snoopy` MCP server (`SNOOPY_MCP_URL`, Bearer `SNOOPY_MCP_TOKEN`)
  + the `web` toolset (`web_search`, `web_extract`). Nothing else: `platform_toolsets`
  allowlists each reachable platform, and `agent.disabled_toolsets` strips
  terminal, file, browser, code execution, delegation, computer-use, and every
  other toolset for good measure.
- **Cron:** `cron/jobs.json` ships a 15-minute feed catch-up job — it arrives
  **paused**; enable with `hermes -p snoopy cron resume feed-scan`.

## Install

```sh
git clone <this-repo> && cd hermes-agent
hermes profile install profiles/snoopy --name snoopy --alias
cd ~/.hermes/profiles/snoopy && cp .env.EXAMPLE .env && $EDITOR .env
hermes -p snoopy gateway install   # always-on service (systemd / launchd)
```

Full machine recipe: `docs/golden-machine.md`.
Local validation (stub MCP + mock model endpoint, no real keys):
`scripts/validate-golden.sh`.
