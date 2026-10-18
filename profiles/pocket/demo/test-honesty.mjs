#!/usr/bin/env node
// demo/test-honesty.mjs — deterministic unit regression for the sanitizer (no network).
//
// Proves the invariant: an unsupported scheduling/delivery-success claim can
// never survive into the user-visible reply — it is REPLACED with
// recording-only wording (not merely annotated). Covers the exact reviewed
// "Te aviso" form plus common Spanish/English scheduling-success forms
// ("quedó programado/agendado", "I have scheduled", "I will notify you").
//
// Run: node demo/test-honesty.mjs

import { detectPromise, sanitizeReply, HONEST_SENTENCE } from "./honesty.mjs";
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

// Independent broad verifier (NOT the module's own patterns) so the unit test
// cannot pass just by agreeing with itself.
const BROAD = /te aviso|te notific|qued[oó] programado|qued[oó] agendado|est[aá] programado|est[aá] agendado|i (?:have|'ve) scheduled|i will notify|you'?ll (?:get|receive) a (?:reminder|notification)|i'?ll (?:remind|ping|nudge|message|text) you|te recuerdo/i;

console.log("1) Overpromising replies are sanitized — the claim does NOT survive");
const OVERPROMISING = [
  "Listo ✅ Te aviso hoy antes de las 5 para lo de tu mamá 🙌", // the reviewed form
  "Apuntado. Te recuerdo la llamada a las 5 en punto.",
  "Te recuerdo lo de tu mamá cerca de las 5, ¿va?",
  "Listo, te aviso el jueves para que no se te pase.",
  "Quedó programado el recordatorio para las 5pm.",
  "Quedó agendado: te notifico a las 5.", // the form that escaped detection in review2
  "Quedó agendado: te notificaré a las 5 en punto.",
  "El recordatorio quedó agendado para mañana.",
  "OK! I have scheduled the reminder.",
  "De one — I will notify you at 5. 🫡",
  "You'll get a reminder before 5pm.",
  "Listo ✅ I'll remind you before 5pm.",
  "Listo ✅ te mando un recordatorio el viernes.",
];
for (const reply of OVERPROMISING) {
  const s = sanitizeReply(reply);
  ok(detectPromise(s.content) === null && !BROAD.test(s.content),
    `claim removed: "${reply.slice(0, 44)}…"`,
    `residual=${JSON.stringify(detectPromise(s.content))} broad=${BROAD.test(s.content)} out=${JSON.stringify(s.content)}`);
  ok(s.replaced === true && s.promise !== null, `  …and flagged as replaced (promise: "${s.promise}")`);
  ok(s.content.length > 10, `  …and still carries useful recording wording`);
}

console.log("2) Honest recording phrasings pass through unchanged");
const HONEST = [
  "Listo ✅ Apuntado: llamar a tu mamá — hoy 5pm. Sale en tu brief y me lo puedes pedir cuando quieras.",
  "Tienes 2 pendientes: pagar el internet (viernes), llamar a tu mamá (hoy 5pm).",
  "Quedó grabado. Si quieres, pídeme el brief más tarde.",
  "Listo ✅ When you ask, I'll show it in your brief.",
];
for (const reply of HONEST) {
  const s = sanitizeReply(reply);
  ok(s.replaced === false && s.content === reply,
    `untouched: "${reply.slice(0, 44)}…"`,
    `out=${JSON.stringify(s.content)}`);
}

console.log("3) Sanitizer never invents a scheduling-success claim (no fake ack path)");
{
  const s = sanitizeReply("Te aviso a las 5.");
  ok(!/programado|agendado|scheduled|notific/i.test(s.content), "sanitized text contains no scheduling-success wording");
  ok(detectPromise(HONEST_SENTENCE) === null, "the honest sentence itself is claim-free");
}

console.log("4) SOUL carries the no-scheduler boundary and no overpromising example");
const soul = readFileSync(path.join(PROFILE_DIR, "SOUL.md"), "utf8");
const voiceExamples = soul.split("## Voice examples")[1] || "";
ok(/no scheduler/i.test(soul) && /never promise/i.test(soul), "SOUL states the no-scheduler rule");
ok(!/te aviso/i.test(voiceExamples) && !/te recuerdo/i.test(voiceExamples) && !/i'?ll remind/i.test(voiceExamples), "SOUL voice examples do not promise a future message");

console.log("");
if (failed === 0) { console.log("PASS — honesty sanitizer unit regression"); process.exit(0); }
console.log(`FAIL — ${failed} assertion(s) failed`); process.exit(1);
