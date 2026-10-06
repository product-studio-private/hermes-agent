#!/usr/bin/env node
// Stub Snoopy MCP server for golden-machine validation.
//
// Mirrors the production worker's contract exactly: POST /mcp, stateless
// JSON-RPC over plain JSON responses, Bearer auth. Exposes the real snoopy_*
// tool surface with canned payloads and appends every request to a JSONL log
// so validate-golden.sh can assert discovery (tools/list) and execution
// (tools/call) actually happened through MCP.
//
//   node scripts/stub-mcp-server.mjs [--port 8901] [--token snoopy_key_...]
//                                    [--log /path/to/mcp-calls.jsonl]
//
// Env: MCP_PORT, MCP_TOKEN (default "snoopy_key_stub_local"), MCP_LOG
// (default <cwd>/mcp-calls.jsonl). GET /healthz is unauthenticated.

import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, env, cwd } from 'node:process';

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const PORT = Number(flag('port', env.MCP_PORT || 8901));
const TOKEN = flag('token', env.MCP_TOKEN || 'snoopy_key_stub_local');
const LOG = resolve(flag('log', env.MCP_LOG || `${cwd()}/mcp-calls.jsonl`));
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const obj = (props = {}, required = []) =>
  ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });

// Same names, scopes, and schema shapes as apps/cloud/src/mcp/tools.ts.
const TOOLS = [
  { name: 'snoopy_status', scope: 'read',
    description: "Get Snoopy's state: agent config, plan, watched X accounts, wallet and launch readiness for the authenticated owner.",
    inputSchema: obj() },
  { name: 'snoopy_feed', scope: 'read',
    description: "The owner's X feed page: recent posts from watched accounts with Snoopy's analysis and launch/buy/skip verdicts.",
    inputSchema: obj({ cursor: str('Pagination cursor from a previous feed call') }) },
  { name: 'snoopy_watchlist', scope: 'read',
    description: 'List the X accounts Snoopy watches for the authenticated owner, with per-account stats.',
    inputSchema: obj() },
  { name: 'snoopy_watch', scope: 'trade',
    description: 'Start watching an X account. Respects plan limits.',
    inputSchema: obj({ handle: str('X handle to watch, with or without @') }, ['handle']) },
  { name: 'snoopy_unwatch', scope: 'trade',
    description: 'Stop watching an X account.',
    inputSchema: obj({ handle: str('X handle to stop watching, with or without @') }, ['handle']) },
  { name: 'snoopy_presets', scope: 'read',
    description: "The owner's launch presets and strategy configuration: launch modes, venue, trade size, slippage, plan limits, and the current strategy text.",
    inputSchema: obj() },
  { name: 'snoopy_set_strategy', scope: 'trade',
    description: "Update Snoopy's strategy: the free-text playbook, personality, launch mode and/or launch confirmation requirement.",
    inputSchema: obj({
      strategy: str('Free-text trading rules (max 4000 chars)'),
      personality: str('Agent personality (max 4000 chars)'),
      launchMode: { type: 'string', enum: ['dj', 'normal', 'strict'], description: 'How aggressively Snoopy drafts launches' },
      confirmBeforeLaunch: { type: 'boolean', description: 'Require an explicit confirm before a launch executes' },
    }) },
  { name: 'snoopy_wallets', scope: 'read',
    description: "The owner's wallets: Solana execution wallet address and balance, and the test-chain engine wallet. Addresses and balances only — never keys.",
    inputSchema: obj() },
  { name: 'snoopy_positions', scope: 'read',
    description: "Open positions: token holdings in the owner's Solana execution wallet with names/symbols where known.",
    inputSchema: obj() },
  { name: 'snoopy_alerts', scope: 'read',
    description: 'Things needing attention: failed or stuck execution journal entries, pending moves, and launch readiness blockers.',
    inputSchema: obj() },
  { name: 'snoopy_chat', scope: 'trade',
    description: 'Send a message to Snoopy and get its reply.',
    inputSchema: obj({ message: str('The message to send (max 1000 chars)') }, ['message']) },
  { name: 'snoopy_launch', scope: 'trade',
    description: 'Draft a pump.fun coin from a tweet URL, a post id, or a free-text idea. Returns a draft id; nothing launches until snoopy_confirm_launch.',
    inputSchema: obj({ tweet_url_or_idea: str('A tweet URL, numeric post id, or free-text coin idea') }, ['tweet_url_or_idea']) },
  { name: 'snoopy_confirm_launch', scope: 'trade',
    description: "Confirm and EXECUTE a pending launch draft. Irreversible — only call after the owner explicitly approves the draft.",
    inputSchema: obj({ draft_id: str('Draft id returned by snoopy_launch') }, ['draft_id']) },
  { name: 'snoopy_dismiss_launch', scope: 'trade',
    description: 'Dismiss a pending launch draft so it cannot be confirmed.',
    inputSchema: obj({ draft_id: str('Draft id returned by snoopy_launch') }, ['draft_id']) },
  { name: 'snoopy_skip', scope: 'trade',
    description: 'Skip a pending launch draft — records a pass so it cannot be confirmed.',
    inputSchema: obj({ draft_id: str('Draft id returned by snoopy_launch') }, ['draft_id']) },
  { name: 'snoopy_buy', scope: 'trade',
    description: "Buy an existing token from the owner's delegated Solana wallet. Irreversible.",
    inputSchema: obj({ mint: str('Token mint address to buy'), amount_lamports: str('Lamports to spend') }, ['mint']) },
  { name: 'snoopy_sell', scope: 'trade',
    description: "Sell tokens from the owner's delegated Solana wallet. Irreversible.",
    inputSchema: obj({ mint: str('Token mint address to sell'), token_amount: str('Token amount in base units') }, ['mint', 'token_amount']) },
];

const CANNED = {
  snoopy_status: () => ({
    agentName: 'stub-owner', planId: 'pro',
    accounts: [{ handle: 'alpha_watcher', posts7d: 41 }],
    wallet: { ready: true },
    solana: { executionReady: true, wallet: { address: 'StubWa11et111111111111111111111111111111111', balanceLamports: '2500000000' } },
  }),
  snoopy_feed: (args) => ({
    timeline: [
      { id: 'p1', account: 'alpha_watcher', text: 'new $TREAT dropping on pump.fun in 10 — this one runs', verdict: 'launch', ts: '2026-10-06T13:00:00Z' },
      { id: 'p2', account: 'alpha_watcher', text: '$DOGWIFHAT part 4, buying the dip again', verdict: 'skip', ts: '2026-10-06T12:40:00Z' },
      { id: 'p3', account: 'launch_lens', text: 'gm — watching $WAGMI presale', verdict: 'buy', ts: '2026-10-06T12:10:00Z' },
    ],
    nextCursor: args.cursor ? null : 'c2',
  }),
  snoopy_watchlist: () => ({
    accounts: [
      { handle: 'alpha_watcher', posts7d: 41, hitRate: 0.62 },
      { handle: 'launch_lens', posts7d: 18, hitRate: 0.44 },
    ],
  }),
  snoopy_watch: (a) => `Now watching @${String(a.handle || '').replace(/^@/, '')}`,
  snoopy_unwatch: (a) => `Stopped watching @${String(a.handle || '').replace(/^@/, '')}`,
  snoopy_presets: () => ({
    strategy: 'First-hour launches only. Max 0.5 SOL per entry. Never chase recycled tickers.',
    personality: '', launchMode: 'normal', confirmBeforeLaunch: true,
    launchModes: ['dj', 'normal', 'strict'],
    execution: { venue: 'pump.fun', amountLamports: '500000000', slippageBps: 1500 },
    planId: 'pro',
  }),
  snoopy_set_strategy: (a) => `Strategy saved (${Object.keys(a).join(', ') || 'nothing to update'}).`,
  snoopy_wallets: () => ({
    solana: { address: 'StubWa11et111111111111111111111111111111111', provider: 'pump.fun', balanceLamports: '2500000000' },
    engine: { address: '0xSTUBENGINEWALLET0000000000000000000000', provider: 'engine', chainId: 8453, balanceWei: '0' },
  }),
  snoopy_positions: () => ({
    positions: [{ mint: 'StubMint1111111111111111111111111111111111', symbol: 'TREAT', amount: '1000000' }],
    holdings: [], balanceUpdatedAt: '2026-10-06T13:00:00Z',
  }),
  snoopy_alerts: () => ({ executionReady: true, selected: true, pending: [], failed: [] }),
  snoopy_chat: (a) => `Snoopy stub reply to: ${String(a.message || '').slice(0, 80)}`,
  snoopy_launch: (a) => ({ draftId: 'draft_stub_001', status: 'drafted', input: String(a.tweet_url_or_idea || '').slice(0, 120) }),
  snoopy_confirm_launch: (a) => ({ draftId: a.draft_id, status: 'launched', tx: 'stub-sig-confirm' }),
  snoopy_dismiss_launch: (a) => ({ draftId: a.draft_id, status: 'dismissed' }),
  snoopy_skip: (a) => ({ draftId: a.draft_id, status: 'skipped' }),
  snoopy_buy: (a) => ({ mint: a.mint, amountLamports: a.amount_lamports || '500000000', status: 'submitted', tx: 'stub-sig-buy' }),
  snoopy_sell: (a) => ({ mint: a.mint, tokenAmount: a.token_amount, status: 'submitted', tx: 'stub-sig-sell' }),
};

let requestLogCount = 0;
function logRequest(entry) {
  requestLogCount += 1;
  try {
    appendFileSync(LOG, JSON.stringify({ seq: requestLogCount, ts: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* logging is for validation; never fail a request over it */ }
}

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const toolText = (value, structured) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  ...(structured && typeof structured === 'object' ? { structuredContent: structured } : {}),
});

function handleMessage(msg) {
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg.id ?? null, -32600, 'Invalid Request');
  }
  const id = msg.id === undefined ? null : msg.id;
  switch (msg.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(msg.params?.protocolVersion)
          ? msg.params.protocolVersion : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'snoopy-stub', version: '0.1.0' },
        instructions: 'Snoopy stub MCP server: canned feed/watchlist/wallet/launch/trade tools for golden-machine validation.',
      });
    case 'ping':
      return rpcResult(id, {});
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const params = msg.params || {};
      const name = typeof params.name === 'string' ? params.name : '';
      const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
      const fn = CANNED[name];
      if (!fn) return rpcResult(id, { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true });
      const out = fn(args);
      const structured = typeof out === 'object' && out !== null ? out : undefined;
      return rpcResult(id, toolText(out, structured));
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, requests: requestLogCount, log: LOG }));
    return;
  }
  if (url.pathname !== '/mcp') {
    res.writeHead(404).end('Not Found');
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' }).end('Method Not Allowed');
    return;
  }
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${TOKEN}`) {
    logRequest({ method: 'auth', denied: true, auth: auth ? 'bad-token' : 'missing' });
    res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' })
      .end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  const t0 = performance.now();
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let messages, batch = false;
    try {
      const parsed = JSON.parse(body);
      batch = Array.isArray(parsed);
      messages = batch ? parsed : [parsed];
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify(rpcError(null, -32700, 'Parse error')));
      return;
    }
    const responses = [];
    for (const msg of messages) {
      logRequest({ method: msg.method, tool: msg.params?.name, args: msg.params?.arguments,
        id: msg.id ?? null, dur_ms: +(performance.now() - t0).toFixed(2) });
      const out = handleMessage(msg);
      if (out) responses.push(out);
    }
    if (!responses.length) {
      res.writeHead(202).end(); // notifications only
      return;
    }
    const payload = batch ? responses : responses[0];
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify(payload));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[stub-mcp] listening on http://127.0.0.1:${PORT}/mcp (token=${TOKEN.slice(0, 12)}…, log=${LOG})`);
});
