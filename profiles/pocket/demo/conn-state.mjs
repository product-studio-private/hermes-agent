// demo/conn-state.mjs — connection-badge state machine for the Pocket demo.
//
// Single source of truth for what the UI badge may claim, so the transitions
// are deterministically testable without a DOM:
//   - state: 'testing' | 'ok' | 'fail' | 'unverified'
//   - model: ONLY what a verified successful call actually reported, or null.
//     Each successful probe/chat SETS model to the reported value or null —
//     a later null-model success must clear a previously known model, never
//     retain it, and never fall back to a configured model string.
//   - detail: latency for ok; a safe error class for fail (never provider
//     bodies/secrets).
//
// A REJECTED fetch (network down / invalid JSON) is a failure transition too:
// onNetworkError() flips the badge so no stale green state survives.
//
// The UI wires apply(state, info) to the DOM; tests record the emissions.

export const UNKNOWN_MODEL_LABEL = "modelo desconocido";

export function createConnState(apply) {
  let state = "testing";
  let model = null;
  const emit = (detail) => apply(state, { model, detail: detail ?? null });
  return {
    get state() { return state; },
    get model() { return model; },
    // GET /api/health result: only meaningful while still probing.
    onHealth({ keyPresent } = {}) {
      if (state === "testing" && keyPresent === false) { state = "unverified"; emit(); }
    },
    // GET /api/ping result (verified round-trip).
    onPing(p) {
      if (p && p.ok) {
        state = "ok";
        model = p.model || null; // reported or null — never a configured fallback
        emit(p.latencyMs != null ? `${(p.latencyMs / 1000).toFixed(1)}s` : null);
      } else {
        state = "fail";
        model = p?.model || null; // failed probe verifies nothing
        emit(p?.errorClass || "error");
      }
    },
    // A successful chat turn: re-verify model on EVERY success.
    onChatOk(j) {
      state = "ok";
      model = j?.model || null; // null clears a previously known model
      emit(j?.latencyMs != null ? `${(j.latencyMs / 1000).toFixed(1)}s` : null);
    },
    // A chat turn that returned a provider-failure JSON (e.g. 502 + errorClass).
    onChatError(errorClass) {
      state = "fail";
      emit(errorClass || "error");
    },
    // A REJECTED fetch or invalid JSON after any prior success: failure, no
    // stale green.
    onNetworkError() {
      state = "fail";
      emit("red");
    },
  };
}

// Pure label builder shared by the UI and the tests.
export function connLabel(state, { model, detail }) {
  const modelLabel = model || UNKNOWN_MODEL_LABEL;
  const footer = "SMS simulado · sin agenda activa";
  if (state === "ok") {
    return {
      chip: `EN VIVO · ${modelLabel}${detail ? ` · ${detail}` : ""}`,
      status: `conexión: en vivo${detail ? ` (${detail})` : ""} · ${modelLabel} · ${footer}`,
    };
  }
  if (state === "fail") {
    return {
      chip: "SIN CONEXIÓN",
      status: `conexión: fallida (${detail || "error"}) · ${modelLabel} · ${footer}`,
    };
  }
  if (state === "unverified") {
    return {
      chip: "NO VERIFICADO",
      status: `conexión: no verificada (sin API key) · ${footer}`,
    };
  }
  return { chip: "PROBANDO…", status: `conexión: probando… · ${footer}` };
}
