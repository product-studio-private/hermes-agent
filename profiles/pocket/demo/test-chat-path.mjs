#!/usr/bin/env node
// demo/test-chat-path.mjs — deterministic full-path regression with an
// overpromising STUB provider (no real network, no real credits).
//
// Verifies the ACTUAL /api/chat response path and the history passed to the
// provider on the next turn:
//   1. An overpromising stub reply ("Te aviso a las 5.") is sanitized in the
//      HTTP response — the unsupported promise is absent from reply.
//   2. The assistant message STORED in history (what the stub receives on the
//      next call) also carries no promise.
//   3. Covers "quedó programado/agendado" and "I have scheduled / I will
//      notify you" forms through the same path.
//   4. The model shown is the one the verified call actually returned
//      (including a missing/unknown model), never a hardcoded string.
//   5. A provider failure after an initially successful call returns 502 with
//      an error class only — no provider body (secret marker must not leak).
//
// No scheduler exists in this demo and none is faked here.
//
// Run: node demo/test-chat-path.mjs

import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_SERVER = path.join(__dirname, "server.mjs");

const STUB_PORT = 8891;
const DEMO_PORT = 8892;
const STUB_SECRET = "stub-secret-marker-do-not-leak";

let failed = 0;
function ok(cond, name, detail = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Stub provider: scripted OpenAI-compatible responses on loopback ────────────
const calls = []; // every messages array the provider receives
const SCRIPT = [
  { content: "Listo ✅ Apuntado: llamar a tu mamá — hoy 5pm. Te aviso a las 5.", model: "stub-test-model" },
  { content: "Quedó programado el recordatorio para las 5pm. I have scheduled it and I will notify you at 5.", model: "stub-test-model-2" },
  { content: "Quedó agendado: te notifico a las 5 en punto.", model: null }, // unknown model
  { httpStatus: 500, body: { error: STUB_SECRET } }, // failure after success
];
let scriptIdx = 0;

const stub = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/calls") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(calls));
    return;
  }
  if (req.method === "POST" && req.url === "/chat/completions") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { messages } = JSON.parse(body);
      calls.push(messages);
      // The demo server's connection probe sends exactly one "ping" user
      // message: answer with a SUCCESS that has NO model field, proving the
      // server reports null instead of the configured model.
      if (messages.length === 1 && messages[0]?.content === "ping") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          model: null,
          choices: [{ message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
        return;
      }
      const step = SCRIPT[Math.min(scriptIdx++, SCRIPT.length - 1)];
      if (step.httpStatus) {
        res.writeHead(step.httpStatus, { "Content-Type": "application/json" });
        res.end(JSON.stringify(step.body));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        model: step.model,
        choices: [{ message: { role: "assistant", content: step.content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }));
    });
    return;
  }
  res.writeHead(404); res.end("{}");
});

await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));

// ── Demo server as a real child process against the stub ──────────────────────
const child = spawn(process.execPath, [DEMO_SERVER], {
  env: {
    ...process.env,
    POCKET_MODEL_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
    ABLITERATION_API_KEY: "stub-key-not-real",
    PORT: String(DEMO_PORT),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", (d) => (serverLog += d));
child.stderr.on("data", (d) => (serverLog += d));

async function waitForServer(ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`http://127.0.0.1:${DEMO_PORT}/api/health`);
      if (r.ok) return true;
    } catch {}
    await sleep(200);
  }
  return false;
}
const up = await waitForServer();
ok(up, "demo server started against the stub", serverLog.slice(0, 200));

const post = (text, sessionId) =>
  fetch(`http://127.0.0.1:${DEMO_PORT}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, sessionId }),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));

try {
  if (up) {
    console.log("0) Connection probe with a missing model reports null — never the configured model");
    const ping = await fetch(`http://127.0.0.1:${DEMO_PORT}/api/ping`).then((r) => r.json());
    ok(ping.ok === true, "probe against model-less stub success is ok", JSON.stringify(ping));
    ok(ping.model === null || ping.model === undefined,
      "probe reports the actual (missing) model as null — no configured fallback",
      JSON.stringify(ping));

    console.log("1) Timed-reminder turn — the reviewed 'Te aviso' form is sanitized in the HTTP response");
    const t1 = await post("Recuérdame llamar a mi mamá a las 5pm en punto, ¿me avisas?", "path-test");
    ok(t1.status === 200, "turn 1 HTTP 200");
    ok(!/te aviso/i.test(t1.json.reply) && t1.json.sanitized === true,
      "reply carries no 'Te aviso' claim and is flagged sanitized",
      JSON.stringify(t1.json.reply));
    ok(/apuntado|grabado|5pm/i.test(t1.json.reply), "reply keeps the useful recording wording", JSON.stringify(t1.json.reply));
    ok(t1.json.model === "stub-test-model", "model is the one the verified call returned", String(t1.json.model));

    console.log("2) 'quedó programado/agendado' + 'I have scheduled / I will notify you' forms through the same path");
    const t2 = await post("Apúntame: pagar el internet antes del viernes.", "path-test");
    ok(t2.status === 200 && t2.json.sanitized === true, "turn 2 flagged sanitized");
    ok(!/quedó programado|quedó agendado|scheduled|notify|notifico|te aviso/i.test(t2.json.reply),
      "reply carries none of the scheduling-success forms", JSON.stringify(t2.json.reply));
    ok(/internet|grabado|brief/i.test(t2.json.reply), "reply keeps the task capture", JSON.stringify(t2.json.reply));
    ok(t2.json.model === "stub-test-model-2", "model updated to the second call's actual model (mismatch propagates)", String(t2.json.model));

    console.log("3) Unknown model propagates (no hardcoded model string)");
    const t3 = await post("¿Qué tengo pendiente?", "path-test");
    ok(t3.status === 200 && (t3.json.model === null || t3.json.model === undefined),
      "missing model arrives as null/undefined, never invented", String(t3.json.model));

    console.log("4) Failure after an initially successful call: 502, error class only, no provider body leak");
    const t4 = await post("Dame el brief de hoy.", "path-test");
    ok(t4.status === 502, "turn 4 HTTP 502", String(t4.status));
    ok(!JSON.stringify(t4.json).includes(STUB_SECRET), "stub provider body/secret NOT leaked", JSON.stringify(t4.json));
    ok(/http-500/.test(String(t4.json.errorClass)), "error class identifies the failure", JSON.stringify(t4.json));

    console.log("5) History passed on the next turn carries the SANITIZED assistant messages");
    const stubCalls = await fetch(`http://127.0.0.1:${STUB_PORT}/calls`).then((r) => r.json());
    ok(stubCalls.length >= 4, `stub received ${stubCalls.length} calls`);
    const last = stubCalls[stubCalls.length - 1];
    const assistants = last.filter((m) => m.role === "assistant").map((m) => m.content).join(" | ");
    ok(!/te aviso|te notific|quedó programado|quedó agendado|scheduled|notify you|notifico/i.test(assistants),
      "stored history has no promise in any assistant message", assistants.slice(0, 200));
    ok(/apuntado|grabado/i.test(assistants),
      "stored history keeps the useful recording wording", assistants.slice(0, 200));
    const firstUser = last.find((m) => m.role === "user");
    ok(/Recuérdame/.test(firstUser?.content || ""), "user messages intact in history");
    ok(last[0]?.role === "system" && /Pocket/.test(last[0]?.content || ""), "system prompt (SOUL) intact in history");
  }
} finally {
  child.kill("SIGTERM");
  stub.close();
  await sleep(300);
}

console.log("");
if (failed === 0) { console.log("PASS — chat-path regression with overpromising stub provider"); process.exit(0); }
console.log(`FAIL — ${failed} assertion(s) failed`); process.exit(1);
