// demo/honesty.mjs — capability-honesty guard for the Pocket demo.
//
// Invariant: the app must NEVER claim a reminder is scheduled or will be sent
// in the future unless a real scheduler accepted the job with a verifiable
// result. This demo has no scheduler and no outbound delivery: pendings are
// RECORDED in the chat and surfaced in the brief / when asked. This module
// detects future-delivery promises in model replies and produces the honest
// clarification the UI appends when one slips through (defense in depth after
// the SOUL rule; the SOUL is the first line of defense).
//
// Pure string logic — deterministic, no network. Shared by server.mjs,
// selftest.mjs and test-honesty.mjs.

// Time anchors used with promise verbs ("aviso ... a las 5", "recuerdo ...
// antes del viernes").
const TIME_ANCHOR =
  "(?:a las? \\d|antes d[eo]l?|cerca de|el (?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado|domingo)|ma[ñn]ana|hoy (?:a|en|antes)|(?:en la )?(?:mañana|tarde|noche))";

const PROMISE_PATTERNS = [
  /\bte aviso\b/i, // "Te aviso el jueves" / "te aviso antes de las 5"
  new RegExp(`\\bte (?:lo )?recuerdo\\b[^.?!]{0,40}${TIME_ANCHOR}`, "i"), // "Te recuerdo cerca de las 5"
  /\bte (?:lo )?recuerdo\b/i, // broad: "Te lo recuerdo" (future-leaning)
  /\brecordatorio (?:autom[aá]tico|programado)\b/i,
  /\bte (?:mando|env[ií]o|escribo)\b[^.?!]{0,30}(?:un recordatorio|recordatorio|el jueves|ma[ñn]ana|hoy)\b/i,
  /\bi'?ll (?:remind|ping|nudge|message|text) you\b/i,
  /\bremind(?:ing)? you\b/i,
];

// Detects a future-delivery promise in a model reply. Returns the matched
// phrase or null.
export function detectPromise(text) {
  if (!text) return null;
  for (const re of PROMISE_PATTERNS) {
    const m = String(text).match(re);
    if (m) return m[0];
  }
  return null;
}

// The honest clarification the app appends when a promise slipped through.
export const HONESTY_NOTE =
  "modo demo: queda grabado aquí y sale en tu brief — sin agenda activa, no se envían recordatorios automáticos.";

// Applies the guard to a model reply. Never rewrites the model's words; adds
// the app-level clarification when a future-delivery promise is detected.
export function applyHonestyGuard(reply) {
  const content = String(reply || "").trim();
  const promise = detectPromise(content);
  return {
    content,
    promise, // matched phrase or null
    honestyNote: promise ? HONESTY_NOTE : null,
  };
}
