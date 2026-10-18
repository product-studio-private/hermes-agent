// demo/honesty.mjs — capability-honesty sanitizer for the Pocket demo.
//
// Invariant: the app must NEVER claim a reminder is scheduled or will be sent
// in the future unless a real scheduler accepted the job with a verifiable
// result. This demo has no scheduler and no outbound delivery: pendings are
// RECORDED in the chat and surfaced in the brief / when asked.
//
// sanitizeReply() REPLACES unsupported scheduling/delivery-success claims in a
// model reply with honest recording-only wording — it does not merely append a
// caveat. The sanitized content is what the server returns to the user AND
// stores in conversation history, so the false claim cannot survive into a
// later turn. No fake success/ack path exists: if a promise cannot be
// surgically rewritten, the whole sentence is swapped for the honest sentence.
//
// Pure string logic — deterministic, no network. Shared by server.mjs,
// selftest.mjs, test-honesty.mjs and test-chat-path.mjs.

// Time anchors used with promise verbs ("aviso ... a las 5", "recuerdo ...
// antes del viernes").
const TIME_ANCHOR =
  "(?:a las? \\d|antes d[eo]l?|cerca de|el (?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado|domingo)|ma[ñn]ana|hoy (?:a|en|antes)|(?:en la )?(?:mañana|tarde|noche))";

// Promise patterns: scheduling/delivery SUCCESS or future-delivery claims.
const PROMISE_PATTERNS = [
  /\bte aviso\b/i, // "Te aviso hoy antes de las 5" (the reviewed form)
  new RegExp(`\\bte (?:lo )?recuerdo\\b[^.?!]{0,40}${TIME_ANCHOR}`, "i"),
  /\bte (?:lo )?recuerdo\b/i,
  /\bqued[óo] (?:programado|agendado)\b/i, // "Quedó programado el recordatorio"
  /\best[áa] (?:programado|agendado)\b/i,
  /\brecordatorio (?:autom[aá]tico|programado|agendado)\b/i,
  /\bte (?:mando|env[ií]o|escribo)\b[^.?!]{0,30}(?:un recordatorio|recordatorio|el jueves|ma[ñn]ana|hoy)\b/i,
  /\bi (?:have|'ve) scheduled\b/i,
  /\bi (?:will|'ll) notify you\b/i,
  /\byou'?ll (?:get|receive) a (?:reminder|notification)\b/i,
  /\bi'?ll (?:remind|ping|nudge|message|text) you\b/i,
  /\bremind(?:ing)? you\b/i,
  /\bte notific(?:o|ar[ée]|ar[áa]s)/i,
];

// Detects a scheduling/delivery-success claim in text. Returns the matched
// phrase or null.
export function detectPromise(text) {
  if (!text) return null;
  for (const re of PROMISE_PATTERNS) {
    const m = String(text).match(re);
    if (m) return m[0];
  }
  return null;
}

// The honest sentence used when a whole claim must be swapped out.
export const HONEST_SENTENCE =
  "Queda grabado: sale en tu brief cuando lo pidas (sin agenda activa en este demo, no se envían recordatorios automáticos).";

// Per-pattern honest rewrites (matched phrase → recording-only wording).
const REWRITES = [
  [/\bte aviso\b/i, "queda grabado (sale en tu brief)"],
  [/\bte (?:lo )?recuerdo\b/i, "lo ves en tu brief"],
  [/\bqued[óo] (?:programado|agendado)\b/i, "queda grabado"],
  [/\best[áa] (?:programado|agendado)\b/i, "queda grabado"],
  [/\brecordatorio (?:autom[aá]tico|programado|agendado)\b/i, "registro del pendiente"],
  [/\bte (?:mando|env[ií]o|escribo)\b(?=[^.?!]{0,30}(?:un recordatorio|recordatorio|el jueves|ma[ñn]ana|hoy))/i, "sale en tu brief"],
  [/\bi (?:have|'ve) scheduled\b/i, "I've recorded"],
  [/\bi (?:will|'ll) notify you\b/i, "it's in your brief"],
  [/\byou'?ll (?:get|receive) a (?:reminder|notification)\b/i, "you'll see it in your brief"],
  [/\bi'?ll (?:remind|ping|nudge|message|text) you\b/i, "it's in your brief"],
  [/\bremind(?:ing)? you\b/i, "in your brief"],
  [/\bte notific(?:o|ar[ée]|ar[áa]s)/i, "queda grabado (sale en tu brief)"],
];

function splitSentences(text) {
  return String(text).split(/(?<=[.!?…])\s+/).filter(Boolean);
}

// Sanitizes a model reply.
//   1. Surgical: each known promise phrase is rewritten to recording-only wording.
//   2. Residual: any sentence still carrying a claim is swapped for HONEST_SENTENCE.
//   3. Guarantee: detectPromise(result) === null (whole reply falls back to
//      HONEST_SENTENCE if a pathological pattern ever survives).
// Returns { content, promise, replaced, log } — content is what the server
// returns AND stores; promise is the first claim found in the ORIGINAL text.
export function sanitizeReply(reply) {
  const original = String(reply || "").trim();
  const promise = detectPromise(original);
  if (!promise) return { content: original, promise: null, replaced: false, log: [] };

  const log = [];
  let out = original;
  for (const [re, to] of REWRITES) {
    out = out.replace(re, (m) => { log.push(`${m} → ${to}`); return to; });
  }
  // Residual pass: swap any sentence that still claims.
  out = splitSentences(out)
    .map((s) => (detectPromise(s) ? (log.push(`sentence swapped: ${s.slice(0, 60)}…`), HONEST_SENTENCE) : s))
    .join(" ");
  // Final guarantee.
  if (detectPromise(out)) {
    log.push("fallback: whole reply replaced");
    out = HONEST_SENTENCE;
  }
  return { content: out, promise, replaced: true, log };
}
