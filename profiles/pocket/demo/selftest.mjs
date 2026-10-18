#!/usr/bin/env node
// demo/selftest.mjs — Pocket demo local test.
//
// Runs a scripted 3-turn Spanish conversation through the same chatTurn path
// the demo server uses (real abliteration.ai inference), asserts each reply
// is non-empty and answers in Spanish, validates the profile YAML/JSON files
// exist and parse, and writes an evidence transcript to demo/evidence/.
//
// Run:  node demo/selftest.mjs
// Env:  same as demo/server.mjs (ABLITERATION_API_KEY or models.json fallback)

import { chatTurn } from "./server.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(PROFILE_DIR, "..", "..");

// ── 1. Static checks: profile files exist and parse ───────────────────────────
const checks = [];
function check(name, fn) {
  try { fn(); checks.push(["PASS", name]); } catch (e) { checks.push(["FAIL", `${name} — ${e.message}`]); }
}

check("SOUL.md exists and is non-trivial", () => {
  const soul = readFileSync(path.join(PROFILE_DIR, "SOUL.md"), "utf8");
  if (soul.length < 500) throw new Error(`only ${soul.length} chars`);
  if (!/Pocket/.test(soul)) throw new Error("persona name missing");
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

// ── 2. Live checks: scripted Spanish conversation through the real model ──────
const SCRIPT = [
  "Buenas! ¿me puedes recordar de qué tengo que acordarme hoy?",
  "Apúntame: llamar a mi mamá hoy a las 5pm, y pagar el internet antes del viernes.",
  "Dame el brief de hoy.",
];

const history = [];
const turns = [];
let liveOk = true;
console.log("Running live 3-turn conversation against the model…");
for (const [i, userText] of SCRIPT.entries()) {
  history.push({ role: "user", content: userText });
  try {
    const turn = await chatTurn(history);
    if (!turn.content) throw new Error("empty reply");
    const spanishish = /[áéíóúñ¿¡]|pendient|recuerd|apunt|brief|hoy|mamá/i.test(turn.content);
    if (!spanishish) throw new Error("reply not recognizably Spanish/on-topic");
    history.push({ role: "assistant", content: turn.content });
    turns.push({ user: userText, ...turn });
    console.log(`  turn ${i + 1}: ${(turn.latencyMs / 1000).toFixed(1)}s · ${turn.content.length} chars · usage ${JSON.stringify(turn.usage?.completion_tokens ?? "?")} completion tokens`);
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
  `- Mode: LIVE inference (scripted conversation, same code path as demo server)`,
  "",
];
for (const t of turns) {
  lines.push(`## User: ${t.user}`, "");
  if (t.error) { lines.push(`**ERROR:** ${t.error}`, ""); continue; }
  lines.push(`**Pocket** (${(t.latencyMs / 1000).toFixed(1)}s · ${t.model} · completion tokens: ${t.usage?.completion_tokens ?? "?"}):`, "", "> " + t.content.replace(/\n/g, "\n> "), "");
}
writeFileSync(path.join(evidenceDir, `transcript-${stamp}.md`), lines.join("\n"));

// ── 4. Summary ───────────────────────────────────────────────────────────────
const staticFail = checks.filter(([s]) => s === "FAIL");
console.log("");
for (const [status, name] of checks) console.log(`  ${status === "PASS" ? "✅" : "❌"} ${name}`);
console.log(`  ${liveOk ? "✅" : "❌"} live conversation (3/3 turns, Spanish, non-empty)`);
console.log("");
if (staticFail.length === 0 && liveOk) {
  console.log(`PASS — evidence written to demo/evidence/transcript-${stamp}.md`);
  process.exit(0);
} else {
  console.log(`FAIL — ${staticFail.length} static failures, live conversation ${liveOk ? "ok" : "failed"}`);
  process.exit(1);
}
