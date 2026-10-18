# pocket — Hermes profile distribution

A personal assistant you text: Spanish-first (LATAM, Medellín home turf),
remembers pendings, delivers a morning brief, researches with web tools, and
helps with the errands people put off. One profile per machine.

## Surface

- **Model:** OpenAI-compatible endpoint. Defaults to
  `https://api.abliteration.ai/v1` with `abliterated-model-large-v2`;
  override with `POCKET_MODEL_BASE_URL` / `POCKET_MODEL`.
- **Tools:** the `web` toolset (`web_search`, `web_extract`). Nothing else:
  `agent.disabled_toolsets` strips terminal, files, browser, code execution,
  delegation, and computer-use. No MCP servers in v0.1.
- **Cron:** `cron/jobs.json` ships a paused 04:00 America/Bogota morning-brief
  job — enable with `hermes -p pocket cron resume morning-brief`.
- **Skill:** `skills/daily-brief/` defines the morning-brief format.

## Demo (no Hermes install needed)

`demo/server.mjs` runs a phone-style chat demo against the same model and
persona — the content-facing preview of this profile. See `demo/README.md`.
In the demo, pendings are RECORDED in the chat (no scheduler, no outbound
delivery); the installed profile's proactive side is the paused Hermes cron
job, which only counts once Hermes + gateway are installed and it is enabled.

## Install

```sh
git clone <this-repo> && cd hermes-agent
hermes profile install profiles/pocket --name pocket --alias
cd ~/.hermes/profiles/pocket && cp .env.template .env && $EDITOR .env
hermes -p pocket chat
```

Live texting (real SMS/WhatsApp delivery) needs a paid phone line and is not
part of v0.1; today the profile runs on Telegram/Discord/WhatsApp/CLI via the
Hermes gateway, and the demo simulates the SMS surface locally (127.0.0.1
listener only).
