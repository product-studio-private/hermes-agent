#!/usr/bin/env node
// demo/server.mjs — Pocket content demo server.
//
// Zero-dependency Node server: serves demo/index.html and proxies chat turns
// to the same OpenAI-compatible endpoint + persona the Hermes profile uses
// (abliteration.ai, abliterated-model-large-v2). Model inference is LIVE;
// the SMS-like surface is simulated locally (no phone line). Pendings are
// RECORDED in the chat — there is no scheduler and no outbound delivery in
// this demo; replies pass through the honesty guard (demo/honesty.mjs).
//
// Run:  node demo/server.mjs   (then open http://localhost:8788)
// Env:  ABLITERATION_API_KEY   (fallback: reads ~/.aside/u/0/models.json
//                             provider "abliteration" — local convenience only)
//       POCKET_MODEL           (default abliterated-model-large-v2)
//       POCKET_MODEL_BASE_URL  (default https://api.abliteration.ai/v1)
//       PORT                   (default 8788)
// Bind: 127.0.0.1 only (local demo; never exposed to the network).

import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { sanitizeReply } from "./honesty.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.resolve(__dirname, "..");

const MODEL = process.env.POCKET_MODEL || "abliterated-model-large-v2";
const BASE_URL = (process.env.POCKET_MODEL_BASE_URL || "https://api.abliteration.ai/v1").replace(/\/$/, "");
const PORT = Number(process.env.PORT || 8788);
const HOST = "127.0.0.1"; // local-only listener
const MAX_HISTORY = 24; // messages of history sent to the model per turn

// ── Key resolution ────────────────────────────────────────────────────────────
function resolveApiKey() {
  if (process.env.ABLITERATION_API_KEY) return process.env.ABLITERATION_API_KEY;
  try {
    const modelsPath = path.join(os.homedir(), ".aside/u/0/models.json");
    const cfg = JSON.parse(readFileSync(modelsPath, "utf8"));
    return cfg.providers?.abliteration?.apiKey || "";
  } catch {
    return "";
  }
}

// ── Persona ───────────────────────────────────────────────────────────────────
function loadSoul() {
  return readFileSync(path.join(PROFILE_DIR, "SOUL.md"), "utf8");
}

// ── Raw model call ───────────────────────────────────────────────────────────
async function modelCall(messages, maxTokens) {
  const key = resolveApiKey();
  if (!key) { const err = new Error("no api key"); err.errorClass = "no-key"; throw err; }
  let res;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens }),
    });
  } catch (e) { e.errorClass = "network"; throw e; }
  if (!res.ok) { const err = new Error(`model HTTP ${res.status}`); err.errorClass = `http-${res.status}`; throw err; }
  return res.json();
}

// ── Chat turn (shared with selftest.mjs) ──────────────────────────────────────
export async function chatTurn(history, { maxTokens = 1500 } = {}) {
  const messages = [{ role: "system", content: loadSoul() }, ...history.slice(-MAX_HISTORY)];
  const t0 = Date.now();
  const out = await modelCall(messages, maxTokens);
  const msg = out.choices?.[0]?.message || {};
  const content = (msg.content || "").trim();
  return {
    content,
    model: out.model,
    usage: out.usage,
    latencyMs: Date.now() - t0,
    finishReason: out.choices?.[0]?.finish_reason,
  };
}

// Connection probe: one tiny REAL completion. The UI shows LIVE/verified only
// from this result — never merely because a key is present.
let lastPing = null; // {ok, latencyMs, model, errorClass, at}
export async function pingProvider() {
  const t0 = Date.now();
  try {
    const out = await modelCall([{ role: "user", content: "ping" }], 16);
    lastPing = { ok: true, latencyMs: Date.now() - t0, model: out.model || MODEL, errorClass: null, at: Date.now() };
  } catch (err) {
    lastPing = { ok: false, latencyMs: Date.now() - t0, model: MODEL, errorClass: err.errorClass || "unknown", at: Date.now() };
  }
  return lastPing;
}

// ── Sessions (in-memory) ─────────────────────────────────────────────────────
const sessions = new Map();
function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(path.join(__dirname, "index.html")));
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    // Static wiring info only. Connection state is UNKNOWN until /api/ping
    // does a real round-trip — keyPresent is not proof of connectivity.
    json(200, { ok: true, model: MODEL, baseUrl: BASE_URL, keyPresent: !!resolveApiKey(), connection: "unknown" });
    return;
  }
  if (req.method === "GET" && req.url === "/api/ping") {
    json(200, await pingProvider()); // {ok, latencyMs, model, errorClass} — no provider bodies/secrets
    return;
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let payload;
    try { payload = JSON.parse(body); } catch { json(400, { error: "invalid JSON" }); return; }
    const text = String(payload.text || "").trim();
    const sessionId = String(payload.sessionId || "default");
    const reset = !!payload.reset;
    if (!text || reset) {
      if (reset) sessions.set(sessionId, []);
      json(200, { reply: "", reset: true });
      return;
    }
    const history = getSession(sessionId);
    history.push({ role: "user", content: text });
    try {
      const turn = await chatTurn(history);
      // Capability honesty: an unsupported scheduling/delivery claim is REPLACED
      // with recording-only wording. The sanitized content is what the user
      // sees AND what is stored in history — the false claim never survives
      // into a later turn. No scheduler exists in this demo, so there is no
      // success/ack path to claim.
      const sanitized = sanitizeReply(turn.content);
      history.push({ role: "assistant", content: sanitized.content });
      json(200, {
        reply: sanitized.content, // sanitized, never the raw promise
        sanitized: sanitized.replaced, // true iff a claim was rewritten
        promise: sanitized.promise, // the claim as found in the original
        model: turn.model,
        latencyMs: turn.latencyMs,
        usage: turn.usage,
      });
    } catch (err) {
      history.pop(); // don't leave an unanswered user turn in history
      json(502, { error: `modelo no respondió (${err.errorClass || "unknown"})`, errorClass: err.errorClass || "unknown" });
    }
    return;
  }
  json(404, { error: "not found" });
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  server.listen(PORT, HOST, () => {
    console.log(`Pocket demo: http://${HOST}:${PORT}  (model: ${MODEL} @ ${BASE_URL})`);
    console.log(`Listener bound to ${HOST} only — local demo, not exposed.`);
  });
}
