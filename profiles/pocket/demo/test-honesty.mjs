#!/usr/bin/env node
// demo/test-honesty.mjs — focused deterministic regression test (no network).
//
// Proves that a timed-reminder request can never surface a scheduling or
// delivery success claim without a scheduler acknowledgement:
//   1. Provider replies that overpromise (the exact shapes seen in review)
//      are detected, and the app-level honest note is attached.
//   2. Plain recording phrasings do NOT trigger the note.
//   3. The SOUL (system prompt) itself carries the no-scheduler rule and no
//      overpromising example.
//
// Run: node demo/test-honesty.mjs

import { detectPromise, applyHonestyGuard, HONESTY_NOTE } from "./honesty.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.resolve(__dirname, "..");

let failed = 0;
function ok(cond, name, detail = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); }
}

console.log("1) Overpromising provider replies are detected and annotated");
const OVERPROMISING = [
  "Listo ✅ Te aviso hoy antes de las 5 para lo de tu mamá 🙌",
  "Apuntado. Te recuerdo la llamada a las 5 en punto.",
  "Te recuerdo lo de tu mamá cerca de las 5, ¿va?",
  "Listo, te aviso el jueves para que no se te pase.",
  "OK! I'll remind you before 5pm.",
  "De one, I'll ping you at 5. 🫡",
  "Listo ✅ te mando un recordatorio el viernes.",
];
for (const reply of OVERPROMISING) {
  const g = applyHonestyGuard(reply);
  ok(g.promise !== null && g.honestyNote === HONESTY_NOTE,
    `promise detected: "${reply.slice(0, 48)}…"`,
    `promise=${JSON.stringify(g.promise)}`);
}

console.log("2) Honest recording phrasings do NOT trigger the note");
const HONEST = [
  "Listo ✅ Apuntado: llamar a tu mamá — hoy 5pm. Sale en tu brief y me lo puedes pedir cuando quieras.",
  "Tienes 2 pendientes: pagar el internet (viernes), llamar a tu mamá (hoy 5pm).",
  "Quedó grabado. Si quieres, pídeme el brief más tarde.",
  "Listo ✅ When you ask, I'll show it in your brief.",
];
for (const reply of HONEST) {
  const g = applyHonestyGuard(reply);
  ok(g.promise === null && g.honestyNote === null,
    `no false promise: "${reply.slice(0, 48)}…"`,
    `promise=${JSON.stringify(g.promise)}`);
}

console.log("3) SOUL carries the no-scheduler boundary and no overpromising example");
const soul = readFileSync(path.join(PROFILE_DIR, "SOUL.md"), "utf8");
const voiceExamples = soul.split("## Voice examples")[1] || "";
ok(/no scheduler/i.test(soul) && /never promise/i.test(soul), "SOUL states the no-scheduler rule");
ok(!/te aviso/i.test(voiceExamples) && !/te recuerdo/i.test(voiceExamples) && !/i'?ll remind/i.test(voiceExamples), "SOUL voice examples do not promise a future message");

console.log("4) Guard is pure (no scheduler side effects — nothing to ack, nothing claimed)");
const g0 = applyHonestyGuard("Te aviso a las 5.");
ok(g0.promise === "Te aviso" && g0.content === "Te aviso a las 5.", "guard only annotates, never rewrites the model's words");

console.log("");
if (failed === 0) { console.log("PASS — honesty guard regression test"); process.exit(0); }
console.log(`FAIL — ${failed} assertion(s) failed`); process.exit(1);
