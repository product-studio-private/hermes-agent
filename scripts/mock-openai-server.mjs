#!/usr/bin/env node
// Mock OpenAI-compatible endpoint for golden-machine validation.
//
// POST /v1/chat/completions — scripted, deterministic:
//   * while the transcript has no `tool` result message, reply with ONE
//     tool_call for MOCK_TOOL (default: first mcp__snoopy__* name seen in the
//     request's `tools` list — so it always calls a tool Hermes registered).
//   * once a tool result is present, reply with a final text answer.
// Supports both stream:false (JSON) and stream:true (SSE chunks + [DONE]).
// GET /v1/models returns MOCK_MODEL for provider discovery probes.
// Every request is appended as JSONL to MOCK_LOG for evidence/latency.
//
//   node scripts/mock-openai-server.mjs [--port 8902] [--log req.jsonl]
// Env: MOCK_PORT, MOCK_LOG, MOCK_MODEL, MOCK_TOOL, MOCK_ARGS (JSON).

import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, env, cwd } from 'node:process';

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const PORT = Number(flag('port', env.MOCK_PORT || 8902));
const LOG = resolve(flag('log', env.MOCK_LOG || `${cwd()}/mock-openai.jsonl`));
const MODEL = env.MOCK_MODEL || 'snoopy-stub-model';
const FIXED_TOOL = env.MOCK_TOOL || '';
const FIXED_ARGS = env.MOCK_ARGS || '';

let seq = 0;
function log(entry) {
  seq += 1;
  try { appendFileSync(LOG, JSON.stringify({ seq, ts: new Date().toISOString(), ...entry }) + '\n'); } catch {}
}

function pickTool(tools) {
  if (FIXED_TOOL) return { name: FIXED_TOOL, arguments: FIXED_ARGS || '{}' };
  const names = (tools || []).map((t) => t?.function?.name || t?.name).filter(Boolean);
  const snoopy = names.filter((n) => /snoopy/i.test(n));
  // Prefer feed, then other zero-arg read tools (watch/unwatch/launch/confirm/
  // dismiss/skip/buy/sell/chat all take required args).
  const zeroArg = ['feed', 'status', 'positions', 'alerts', 'wallets', 'watchlist', 'presets']
    .map((k) => snoopy.find((n) => n.includes(k)))
    .find(Boolean) || snoopy[0];
  if (zeroArg) return { name: zeroArg, arguments: '{}' };
  return { name: 'web_search', arguments: JSON.stringify({ query: 'snoopy feed' }) };
}

function completionBody(kind, toolName, toolArgs) {
  const base = {
    id: `chatcmpl-stub-${seq}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: MODEL,
    usage: { prompt_tokens: 128, completion_tokens: 16, total_tokens: 144 },
  };
  if (kind === 'tool_call') {
    return { ...base, choices: [{ index: 0, message: { role: 'assistant', content: null,
      tool_calls: [{ id: 'call_stub_1', type: 'function', function: { name: toolName, arguments: toolArgs } }] },
      finish_reason: 'tool_calls' }] };
  }
  return { ...base, choices: [{ index: 0, message: { role: 'assistant',
    content: 'Feed checked: 3 posts, 1 launch verdict ($TREAT from @alpha_watcher). Wallets ready, no alerts.' },
    finish_reason: 'stop' }] };
}

function sseChunk(obj) { return `data: ${JSON.stringify(obj)}\n\n`; }
function sseStream(res, kind, toolName, toolArgs) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const head = { id: `chatcmpl-stub-${seq}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: MODEL };
  if (kind === 'tool_call') {
    res.write(sseChunk({ ...head, choices: [{ index: 0, delta: { role: 'assistant',
      tool_calls: [{ index: 0, id: 'call_stub_1', type: 'function', function: { name: toolName, arguments: '' } }] }, finish_reason: null }] }));
    res.write(sseChunk({ ...head, choices: [{ index: 0, delta: {
      tool_calls: [{ index: 0, function: { arguments: toolArgs } }] }, finish_reason: null }] }));
    res.write(sseChunk({ ...head, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
  } else {
    res.write(sseChunk({ ...head, choices: [{ index: 0, delta: { role: 'assistant', content: 'Feed checked: 3 posts, 1 launch verdict ($TREAT from @alpha_watcher). Wallets ready, no alerts.' }, finish_reason: null }] }));
    res.write(sseChunk({ ...head, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model', created: 0, owned_by: 'stub' }] }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
    res.writeHead(404).end('Not Found');
    return;
  }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 50e6) req.destroy(); });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400).end('bad json'); return; }
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const hasToolResult = messages.some((m) => m && m.role === 'tool');
    const toolNames = (parsed.tools || []).map((t) => t?.function?.name || t?.name).filter(Boolean);
    const kind = hasToolResult ? 'final' : 'tool_call';
    const picked = kind === 'tool_call' ? pickTool(parsed.tools) : null;
    log({
      path: url.pathname, model: parsed.model, stream: !!parsed.stream, kind,
      n_messages: messages.length, n_tools: toolNames.length, tool_names: toolNames,
      reply_tool: picked?.name,
    });
    if (parsed.stream) return sseStream(res, kind, picked?.name, picked?.arguments);
    res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(completionBody(kind, picked?.name, picked?.arguments)));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-openai] listening on http://127.0.0.1:${PORT}/v1 (model=${MODEL}, log=${LOG})`);
});
