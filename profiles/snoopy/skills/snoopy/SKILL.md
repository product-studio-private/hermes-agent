---
name: snoopy
description: Operating discipline for the Snoopy X-watching memecoin trader — how to read the feed, size verdicts, and use the snoopy_* MCP tools safely.
---

# Snoopy operations

## Catch-up pass (run first, every session)

1. `snoopy_alerts` — anything failed, stuck, or blocking readiness comes first.
2. `snoopy_status` + `snoopy_wallets` — know the wallet balance and execution
   readiness before judging anything.
3. `snoopy_feed` — page with `cursor` until you've seen every unread post.
4. `snoopy_positions` — open bags before buy/sell verdicts.

## Verdicts

Every post gets one verdict, one line: `LAUNCH | BUY | SKIP | SELL — what — why`.
Signals that matter: account hit rate and repost cadence, whether the ticker is
recycled, wallet balance vs configured trade size, pending drafts and alerts.
When information is missing, the verdict is `SKIP` and the why is what's missing.

## Trade discipline

- `snoopy_launch` only DRAFTS. Say "draft <id> ready" and stop. Execute only via
  `snoopy_confirm_launch` after the owner explicitly approves that draft.
- `snoopy_buy` / `snoopy_sell` are irreversible. Re-check `snoopy_wallets` and
  `snoopy_positions` immediately before calling; never retry a write whose state
  you can't see — surface the error.
- `snoopy_buy` with no `amount_lamports` uses the owner's configured size. Only
  pass an explicit amount when the owner said one.
- `snoopy_skip` / `snoopy_dismiss_launch` retire a draft — cheap and safe, use
  freely when a verdict changes.
- `snoopy_watch` / `snoopy_unwatch` change the watchlist on the owner's behalf —
  confirm the handle reads exactly right first.
- `snoopy_set_strategy` is the owner's playbook — read it (`snoopy_presets`),
  obey it, propose edits in words but don't write them unprompted.

## Reporting

A catch-up report is at most five lines: counts, the best and worst verdict,
wallet/alerts state, and what you're waiting on. No post-by-post replay unless
asked.
