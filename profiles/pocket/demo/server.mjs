#!/usr/bin/env node
// demo/server.mjs — Pocket content demo server.
//
// Zero-dependency Node server: serves demo/index.html and proxies chat turns
// to the same OpenAI-compatible endpoint + persona the Hermes profile uses
// (abliteration.ai, abliterated-model-large-v2). Model inference is LIVE;
// the SMS-like surface is simulated locally (no phone line).
//
// Run:  node demo/server.mjs   (then open http://localhost:8788)
// Env:  ABLITERATION_API_KEY   (fallback: reads ~/.aside/u/0/models.json
//                             provider "abliteration" — local convenience only)
//       POCKET_MODEL           (default abliterated-model-large-v2)
//       POCKET_MODEL_BASE_URL  (default https://api.abliteration.ai/v1)
//       PORT                   (default 8788)

import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.resolve(__dirname, "..");

const MODEL = process.env.POCKET_MODEL || "abliterated-model-large-v2";
const BASE_URL = (process.env.POCKET_MODEL_BASE_URL || "https://api.abliteration.ai/v1").replace(/\/$/, "");
const PORT = Number(process.env.PORT || 8788);
const MAX_HISTORY = 24; // messages of history sent to the model per turn

// ── Key resolution ────────────────────────────────────────────────────────────
function resolveApiKey() {
  if (process.env.ABLITERATION_API_KEY) return process.env.ABLITERATION_API_KEY;
  try {
    const modelsPath = path.join(os.homedir(), ".aside/u/0/models.json");
    const cfg = JSON.parse(readFileSync(modelsPath, "utf8"));
    const prov = (cfg.providers || {})[cfg.providers ? "abliteration" : "abliteration"];
    const entry = cfg.providers?.abliteration;
    return entry?.apiKey || prov?.apiKey || "";
  } catch {
    return "";
  }
}

// ── Persona ───────────────────────────────────────────────────────────────────
function loadSoul() {
  return readFileSync(path.join(PROFILE_DIR, "SOUL.md"), "utf8");
}

// ── Chat turn (shared with selftest.mjs) ──────────────────────────────────────
export async function chatTurn(history, { apiKey, maxTokens = 1500 } = {}) {
  const key = apiKey || resolveApiKey();
  if (!key) throw new Error("No ABLITERATION_API_KEY (set env or ~/.aside/u/0/models.json)");
  const messages = [{ role: "system", content: loadSoul() }, ...history.slice(-MAX_HISTORY)];
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`model HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
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

// ── Sessions (in-memory) ─────────────────────────────────────────────────────
const sessions = new Map();
function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(path.join(__dirname, "index.html")));
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, model: MODEL, baseUrl: BASE_URL, keyPresent: !!resolveApiKey() }));
    return;
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }
    const text = String(payload.text || "").trim();
    const sessionId = String(payload.sessionId || "default");
    const reset = !!payload.reset;
    if (!text || reset) {
      if (reset) sessions.set(sessionId, []);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reply: "", reset: true }));
      return;
    }
    const history = getSession(sessionId);
    history.push({ role: "user", content: text });
    try {
      const turn = await chatTurn(history);
      history.push({ role: "assistant", content: turn.content });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        reply: turn.content,
        model: turn.model,
        latencyMs: turn.latencyMs,
        usage: turn.usage,
      }));
    } catch (err) {
      history.pop(); // don't leave an unanswered user turn in history
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  server.listen(PORT, () => {
    console.log(`Pocket demo: http://localhost:${PORT}  (model: ${MODEL} @ ${BASE_URL})`);
  });
}
