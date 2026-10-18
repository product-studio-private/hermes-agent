# demo — Pocket content demo (no Hermes install needed)

A phone-style chat demo of the Pocket personal-assistant profile, built for
founder content: the same persona (SOUL.md) and the same model endpoint
(abliteration.ai, `abliterated-model-large-v2`) as the installed Hermes
profile, without needing a Hermes install or a phone line.

## What is live vs simulated

- **LIVE:** model inference — every reply is a real `abliterated-model-large-v2`
  completion through abliteration.ai, using the profile SOUL as system prompt.
- **SIMULATED:** the SMS/WhatsApp-like surface. No phone line, no carrier, no
  real messages leave the machine. The chat runs in your browser against the
  local demo server.

## Run it

```sh
# key resolution: ABLITERATION_API_KEY env var, or the local
# ~/.aside/u/0/models.json "abliteration" provider entry (fallback).
node demo/server.mjs
# open http://localhost:8788
```

## Local test (scripted live conversation + static checks)

```sh
node demo/selftest.mjs
```

Runs a 3-turn Spanish conversation through the same code path, validates the
profile files, and writes `demo/evidence/transcript-<timestamp>.md`.

## Content notes

- The UI is mobile-first (390px-class), Spanish-first, dark.
- The LIVE chip in the header names the model actually answering.
- Latency shows per reply (model reasons before answering; ~2-5s typical).
- Reset button clears the conversation (sessions are in-memory only).
