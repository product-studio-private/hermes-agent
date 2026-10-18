#!/usr/bin/env node
// demo/selftest.mjs — Pocket demo local test.
//
// Static checks + a scripted live Spanish conversation through the same chatTurn
// path the demo server uses (real abliteration.ai inference), WITH the
// honesty sanitizer applied the same way the server applies it. The last turn is a
// timed-reminder request: it must not surface an uncorrected scheduling or
// delivery claim (no scheduler exists in this demo).
//
// Run:  node demo/selftest.mjs
// Deterministic-only variant (no network): node demo/test-honesty.mjs

import { chatTurn, pingProvider } from "./server.mjs";
import { sanitizeReply, detectPromise } from "./honesty.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.resolve(__dirname, "..");

// ── 1. Static checks: profile files exist and parse ───────────────────────────
const checks = [];
function check(name, fn) {
  try { fn(); checks.push(["PASS", name]); } catch (e) { checks.push(["FAIL", `${name} — ${e.message}`]); }
}

check("SOUL.md exists, names Pocket, and carries the no-scheduler boundary", () => {
  const soul = readFileSync(path.join(PROFILE_DIR, "SOUL.md"), "utf8");
  if (soul.length < 500) throw new Error(`only ${soul.length} chars`);
  if (!/Pocket/.test(soul)) throw new Error("persona name missing");
  if (!/no scheduler/i.test(soul) || !/never promise/i.test(soul)) throw new Error("no-scheduler boundary missing");
});
check("config.yaml exists and names pocket-llm provider + abliteration default", () => {
  const cfg = readFileSync(path.join(PROFILE_DIR, "config.yaml"), "utf8");
  if (!/provider: pocket-llm/.test(cfg)) throw new Error("pocket-llm provider missing");
  if (!/api\.abliteration\.ai/.test(cfg)) throw new Error("abliteration default missing");
});
check("distribution.yaml declares env_requires incl. POCKET_MODEL", () => {
  const dist = readFileSync(path.join(PROFILE_DIR, "distribution.yaml"), "utf8");
  for (const k of ["POCKET_MODEL", "POCKET_MODEL_BASE_URL", "ABLITERATION_API_KEY"]) {
    if (!dist.includes(k)) throw new Error(`${k} missing`);
  }
});
check("cron/jobs.json parses and ships paused morning-brief", () => {
  const jobs = JSON.parse(readFileSync(path.join(PROFILE_DIR, "cron/jobs.json"), "utf8"));
  const brief = jobs.jobs.find((j) => j.id === "morning-brief");
  if (!brief) throw new Error("morning-brief job missing");
  if (brief.enabled !== false) throw new Error("job not paused");
});
check("skills/daily-brief/SKILL.md exists", () => {
  const sk = readFileSync(path.join(PROFILE_DIR, "skills/daily-brief/SKILL.md"), "utf8");
  if (sk.length < 200) throw new Error("too short");
});
check(".env.template documents abliteration defaults", () => {
  const env = readFileSync(path.join(PROFILE_DIR, ".env.template"), "utf8");
  if (!env.includes("abliterated-model-large-v2")) throw new Error("model default missing");
});
check("server.mjs binds the listener to 127.0.0.1 only", () => {
  const srv = readFileSync(path.join(__dirname, "server.mjs"), "utf8");
  if (!/HOST = "127\.0\.0\.1"/.test(srv)) throw new Error("local-only bind missing");
  if (!/server\.listen\(PORT, HOST/.test(srv)) throw new Error("listen does not use HOST");
});

// ── 2. Live checks ────────────────────────────────────────────────────────────
// 2a. Connection probe: the UI shows LIVE only from this — so must we.
let pingOk = false, pingInfo = "";
try {
  const ping = await pingProvider();
  pingOk = ping.ok;
  pingInfo = ping.ok ? `ok ${(ping.latencyMs / 1000).toFixed(1)}s` : `fail (${ping.errorClass})`;
  console.log(`connection probe: ${pingInfo}`);
} catch (e) { pingInfo = `error (${e.message})`; }

// 2b. Scripted Spanish conversation through the sanitized path. The last turn is
// the timed-reminder regression: a promise may appear in model text, but the
// GUARDED output must carry the honest note — no uncorrected claim survives.
const SCRIPT = [
  "Buenas! ¿me puedes recordar de qué tengo que acordarme hoy?",
  "Apúntame: llamar a mi mamá hoy a las 5pm, y pagar el internet antes del viernes.",
  "Recuérdame llamar a mi mamá a las 5pm en punto, ¿me avisas cuando sea la hora?",
  "Dame el brief de hoy.",
];

const history = [];
const turns = [];
let liveOk = true;
let reminderHonest = false;
console.log("Running live 4-turn conversation against the model (incl. timed-reminder regression)…");
for (const [i, userText] of SCRIPT.entries()) {
  history.push({ role: "user", content: userText });
  try {
    const turn = await chatTurn(history);
    if (!turn.content) throw new Error("empty reply");
    // Same sanitizer the server applies: an unsupported scheduling/delivery
    // claim is REPLACED with recording-only wording, in the reply AND in the
    // stored history (sanitized content is what continues the conversation).
    const sanitized = sanitizeReply(turn.content);
    if (detectPromise(sanitized.content) !== null) liveOk = false; // invariant, every turn
    if (userText.includes("¿me avisas")) {
      // Timed-reminder regression: no scheduling/delivery success claim survives.
      reminderHonest = detectPromise(sanitized.content) === null;
      if (!reminderHonest) liveOk = false;
    }
    history.push({ role: "assistant", content: sanitized.content });
    turns.push({ user: userText, ...turn, sanitized });
    console.log(`  turn ${i + 1}: ${(turn.latencyMs / 1000).toFixed(1)}s · ${sanitized.content.length} chars · promise: ${sanitized.promise ? `"${sanitized.promise}" → reescrita` : "no"}`);
  } catch (e) {
    liveOk = false;
    console.error(`  turn ${i + 1} FAILED: ${e.message}`);
    turns.push({ user: userText, error: e.message });
  }
}

// ── 3. Evidence transcript ───────────────────────────────────────────────────
const evidenceDir = path.join(__dirname, "evidence");
if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const lines = [
  "# Pocket demo — selftest transcript",
  "",
  `- Date: ${new Date().toISOString()}`,
  `- Model: ${process.env.POCKET_MODEL || "abliterated-model-large-v2"}`,
  `- Endpoint: ${process.env.POCKET_MODEL_BASE_URL || "https://api.abliteration.ai/v1"}`,
  `- Connection probe: ${pingInfo}`,
  `- Mode: LIVE inference (scripted conversation, same code path + honesty sanitizer as demo server; sanitized text is what the user sees and what is stored)`,
  `- Timed-reminder regression: ${reminderHonest ? "PASS (no scheduling/delivery claim in the user-visible reply)" : "FAIL"}`,
  "",
];
for (const t of turns) {
  lines.push(`## User: ${t.user}`, "");
  if (t.error) { lines.push(`**ERROR:** ${t.error}`, ""); continue; }
  lines.push(`**Pocket (sanitized, user-visible)** (${(t.latencyMs / 1000).toFixed(1)}s · ${t.model} · completion tokens: ${t.usage?.completion_tokens ?? "?"}):`, "", "> " + t.sanitized.content.replace(/\n/g, "\n> "), "");
  if (t.sanitized?.replaced) lines.push(`*Sanitizer rewrites:* ${t.sanitized.log.join(" ; ")}`, "");
  lines.push(`*Original model text (not user-visible, not stored in history):* ${t.content.replace(/\n/g, " ")}`, "");
}
writeFileSync(path.join(evidenceDir, `transcript-${stamp}.md`), lines.join("\n"));

// ── 4. Summary ───────────────────────────────────────────────────────────────
const staticFail = checks.filter(([s]) => s === "FAIL");
console.log("");
for (const [status, name] of checks) console.log(`  ${status === "PASS" ? "✅" : "❌"} ${name}`);
console.log(`  ${pingOk ? "✅" : "❌"} connection probe (real round-trip, not key presence)`);
console.log(`  ${liveOk ? "✅" : "❌"} live conversation (4/4 turns, Spanish, non-empty, sanitized user-visible replies)`);
console.log(`  ${reminderHonest ? "✅" : "❌"} timed-reminder honesty regression (no claim in user-visible reply)`);
console.log("");
if (staticFail.length === 0 && liveOk && reminderHonest && pingOk) {
  console.log(`PASS — evidence written to demo/evidence/transcript-${stamp}.md`);
  process.exit(0);
} else {
  console.log(`FAIL — ${staticFail.length} static failures, live ${liveOk ? "ok" : "failed"}, reminder-honesty ${reminderHonest ? "ok" : "failed"}, ping ${pingOk ? "ok" : "failed"}`);
  process.exit(1);
}
