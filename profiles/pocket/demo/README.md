# demo — Pocket content demo (no Hermes install needed)

A phone-style chat demo of the Pocket personal-assistant profile, built for
founder content: the same persona (SOUL.md) and the same model endpoint
(abliteration.ai, `abliterated-model-large-v2`) as the installed Hermes
profile, without needing a Hermes install or a phone line.

## What is live vs simulated vs not there

- **LIVE:** model inference — every reply is a real `abliterated-model-large-v2`
  completion through abliteration.ai, using the profile SOUL as system prompt.
  The UI's connection chip reflects a real probe round-trip (`/api/ping`):
  `PROBANDO…` (testing) → `EN VIVO` with measured latency, `SIN CONEXIÓN`
  (failed) or `NO VERIFICADO` (no key). It never shows LIVE merely because a
  key is present.
- **SIMULATED:** the SMS/WhatsApp-like surface. No phone line, no carrier, no
  real messages leave the machine. The chat runs in your browser against the
  local demo server.
- **NOT THERE (recorded, not scheduled):** there is no scheduler and no
  outbound delivery in this demo. Pendings are recorded in the current chat
  and surfaced in the brief / when asked. The app never claims a reminder is
  scheduled or will be sent unless a real scheduler accepted the job — none
  exists here. The persona (SOUL) states this rule, and a programmatic
  honesty guard (`honesty.mjs`) appends an honest clarification if a model
  reply ever promises future delivery (e.g. "te aviso a las 5").

## Run it

```sh
# key resolution: ABLITERATION_API_KEY env var, or the local
# ~/.aside/u/0/models.json "abliteration" provider entry (fallback).
node demo/server.mjs
# open http://127.0.0.1:8788 — listener binds 127.0.0.1 ONLY (local demo,
# not exposed to the network).
```

## Tests

```sh
node demo/test-honesty.mjs   # deterministic regression, no network:
                             # timed-reminder promises detected + annotated;
                             # honest phrasings not flagged; SOUL carries the rule
node demo/selftest.mjs       # live: 4-turn Spanish conversation (incl. a
                             # timed-reminder regression turn) through the same
                             # guarded code path + static checks + real ping;
                             # writes demo/evidence/transcript-<timestamp>.md
```

## Content notes

- The UI is mobile-first (390px-class), Spanish-first, dark.
- The connection chip names the model actually answering, verified by a real
  probe before showing EN VIVO; per-reply latency shows on each bubble.
- The model reasons before answering; ~1.5-3s typical per reply.
- Reset button clears the conversation (sessions are in-memory only).

## Before any public deployment (not done here)

Access controls, rate limits and listener scope require review. The demo
listener is local-only (127.0.0.1); a deployed surface would need auth,
rate limiting, and a real scheduler integration before any reminder claim
beyond recording.
