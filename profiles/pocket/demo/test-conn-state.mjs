#!/usr/bin/env node
// demo/test-conn-state.mjs — deterministic regression for the connection
// badge state machine (no network, no DOM).
//
// Covers the reviewed edge cases:
//   - a SUCCESSFUL probe with a missing/null model reports null (never the
//     configured model string),
//   - success-with-model then success-with-null CLEARS the model (unknown is
//     honest on each success),
//   - a REJECTED chat fetch after a successful probe flips the badge to fail
//     (not only the HTTP-500 JSON path).
// Plus label correctness for every state.
//
// Run: node demo/test-conn-state.mjs

import { createConnState, connLabel, UNKNOWN_MODEL_LABEL } from "./conn-state.mjs";

let failed = 0;
function ok(cond, name, detail = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}

function recorder() {
  const seen = [];
  const apply = (state, info) => seen.push({ state, model: info.model, detail: info.detail });
  return { seen, apply };
}

console.log("1) Successful ping with a missing model reports null — never the configured model");
{
  const { seen, apply } = recorder();
  const conn = createConnState(apply);
  conn.onPing({ ok: true, latencyMs: 700, model: null });
  ok(seen.length === 1 && seen[0].state === "ok" && seen[0].model === null,
    "ping ok with null model → state ok, model null", JSON.stringify(seen));
  const { chip } = connLabel(seen[0].state, seen[0]);
  ok(chip.includes(UNKNOWN_MODEL_LABEL) && !chip.includes("abliterated"),
    "label shows unknown, not a configured model", chip);
}

console.log("2) Ping failure also reports model null (nothing verified)");
{
  const { seen, apply } = recorder();
  const conn = createConnState(apply);
  conn.onPing({ ok: false, errorClass: "http-500", model: null });
  ok(seen[0].state === "fail" && seen[0].model === null, "fail state, model null", JSON.stringify(seen));
}

console.log("3) Success-with-model then success-with-null CLEARS the model");
{
  const { seen, apply } = recorder();
  const conn = createConnState(apply);
  conn.onPing({ ok: true, latencyMs: 800, model: "real-model-a" });
  conn.onChatOk({ model: "real-model-b", latencyMs: 1500 });
  conn.onChatOk({ model: null, latencyMs: 1200 }); // later success reports no model
  const last = seen[seen.length - 1];
  ok(last.state === "ok" && last.model === null,
    "third success clears the model to null", JSON.stringify(last));
  const { chip, status } = connLabel(last.state, last);
  ok(chip.includes(UNKNOWN_MODEL_LABEL) && status.includes(UNKNOWN_MODEL_LABEL),
    "labels show unknown after the null-model success", chip + " || " + status);
  ok(!JSON.stringify(seen).includes("abliterated"), "no emission ever invents the configured model");
}

console.log("4) REJECTED chat fetch after a successful probe flips the badge (not only 500-JSON)");
{
  const { seen, apply } = recorder();
  const conn = createConnState(apply);
  conn.onPing({ ok: true, latencyMs: 900, model: "real-model-a" });
  conn.onNetworkError(); // fetch rejection / invalid JSON
  const last = seen[seen.length - 1];
  ok(last.state === "fail", "network rejection → fail", JSON.stringify(last));
  const { chip } = connLabel(last.state, last);
  ok(chip === "SIN CONEXIÓN", "chip shows SIN CONEXIÓN (no stale green)", chip);
}

console.log("5) Provider-failure JSON (502 + errorClass) after success also fails the badge");
{
  const { seen, apply } = recorder();
  const conn = createConnState(apply);
  conn.onPing({ ok: true, latencyMs: 900, model: "real-model-a" });
  conn.onChatError("http-500");
  ok(seen[seen.length - 1].state === "fail", "error-class path → fail");
}

console.log("6) Health without key only matters while still probing; later states win");
{
  const { seen, apply } = recorder();
  const conn = createConnState(apply);
  conn.onHealth({ keyPresent: true }); // no transition while testing
  ok(seen.length === 0, "health with key: no transition");
  conn.onHealth({ keyPresent: false });
  ok(seen.length === 1 && seen[0].state === "unverified", "health without key → unverified");
  conn.onPing({ ok: true, latencyMs: 500, model: "m" });
  ok(seen[seen.length - 1].state === "ok", "a later verified ping overrides unverified");
}

console.log("7) Labels for every state");
{
  ok(connLabel("testing", { model: null }).chip === "PROBANDO…", "testing chip");
  ok(connLabel("unverified", { model: null }).chip === "NO VERIFICADO", "unverified chip");
  ok(connLabel("ok", { model: "m1", detail: "0.7s" }).chip === "EN VIVO · m1 · 0.7s", "ok chip with model+latency");
  ok(connLabel("fail", { model: null, detail: "red" }).status.includes("fallida (red)"), "fail status with class");
}

console.log("");
if (failed === 0) { console.log("PASS — connection-state regression"); process.exit(0); }
console.log(`FAIL — ${failed} assertion(s) failed`); process.exit(1);
