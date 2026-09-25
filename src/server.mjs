#!/usr/bin/env node
// PUPA MCP 서버 — 두 가지 실행 방식
//   --stdio : 내 컴퓨터에서 Claude Desktop/Code·Cursor 가 직접 띄운다 (PUPA_TOKEN 또는 PUPA_ID/PUPA_PW 환경변수, 또는 첫 실행 시 저장된 토큰 파일)
//   --http  : 우리 서버에서 상시 실행 (Streamable HTTP + OAuth) — Claude.ai/ChatGPT 커넥터가 URL 로 붙는다
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools.mjs';
import { PupaApi, DEFAULT_BASE, loadTokenFile, saveTokenFile } from './pupa-api.mjs';
import { createOAuth, OAuthStore, readBody } from './oauth.mjs';

export const VERSION = '0.1.1';
const INSTRUCTIONS = [
  'PUPA(PUPASTAGE) — 한국어 시나리오/광고 콘티를 컷으로 나누고(샷 플래너, 0 크레딧), AI 이미지·영상을 생성한다(WOON 크레딧 차감, 전표 기록).',
  '순서: pupa_prompt_rules → pupa_parse_screenplay → pupa_plan_shots → (pupa_generate_image 로 캐릭터/제품 레퍼런스) → pupa_generate_video → pupa_job_status. 저장은 pupa_save_scenario.',
  '크레딧이 드는 도구(pupa_generate_*)는 호출 전에 pupa_pricing 으로 비용을 말하고 사용자 확인을 받는다. 한국어 대사·자막은 프롬프트 안에서 큰따옴표로 원문 그대로 둔다.'
].join('\n');

export function createPupaServer(getApi) {
  const server = new McpServer({ name: 'pupa-mcp', version: VERSION }, { instructions: INSTRUCTIONS, capabilities: { logging: {} } });
  registerTools(server, getApi);
  return server;
}

/* ───────── stdio ───────── */
export async function runStdio() {
  const base = process.env.PUPA_PROXY_BASE || DEFAULT_BASE;
  const tokFile = process.env.PUPA_TOKEN_FILE || path.join(os.homedir(), '.pupa', 'mcp-token.json');
  let api = null;
  if (process.env.PUPA_TOKEN) api = new PupaApi({ base, token: process.env.PUPA_TOKEN });
  else {
    const saved = loadTokenFile(tokFile);
    if (saved && saved.token) api = new PupaApi({ base: saved.base || base, token: saved.token, rt: saved.rt || '', id: saved.id || '', onToken: (a) => saveTokenFile(tokFile, a) });
    if (process.env.PUPA_ID && process.env.PUPA_PW) { const a = new PupaApi({ base, onToken: (x) => saveTokenFile(tokFile, x) }); try { await a.login(process.env.PUPA_ID, process.env.PUPA_PW); api = a; } catch (e) { console.error('[pupa-mcp] 로그인 실패:', e.message); if (!api) process.exit(2); } }
  }
  if (!api) { console.error('[pupa-mcp] PUPA_TOKEN 또는 PUPA_ID/PUPA_PW 환경변수가 필요합니다'); process.exit(2); }
  const server = createPupaServer(() => api);
  await server.connect(new StdioServerTransport());
  console.error('[pupa-mcp] stdio 준비 — ' + api.base + (api.id ? ' (' + api.id + ')' : ''));
}

/* ───────── http (Streamable HTTP + OAuth) ───────── */
export async function runHttp({ port = +process.env.PORT || 8790, host = process.env.HOST || '127.0.0.1', publicUrl = process.env.PUPA_MCP_PUBLIC || 'https://proxy.pupastage.com/mcp', proxyBase = process.env.PUPA_PROXY_BASE || DEFAULT_BASE, dataDir = process.env.PUPA_MCP_DATA || path.join(process.cwd(), 'data') } = {}) {
  const pub = new URL(publicUrl); const prefix = pub.pathname.replace(/\/+$/, ''); // e.g. /mcp
  const issuer = pub.origin + prefix; // OAuth 엔드포인트는 /mcp/authorize 등
  const store = new OAuthStore(path.join(dataDir, 'oauth.json'));
  const oauth = createOAuth({ issuer, store, proxyBase, resource: publicUrl });
  const sessions = new Map(); // sessionId → { transport, server, api }
  const RAWOK = new Map();    // 프록시 토큰 검증 캐시(5분)
  const strip = (p) => (prefix && p.startsWith(prefix)) ? (p.slice(prefix.length) || '/') : p;

  const srv = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x'); const p0 = url.pathname; const p = strip(p0);
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-expose-headers': 'mcp-session-id' }); return res.end(); }
      if (p === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, name: 'pupa-mcp', v: VERSION, sessions: sessions.size })); }
      // OAuth + well-known (prefix 유무 모두)
      const u2 = new URL(url); u2.pathname = p;
      if (await oauth.handle(req, res, u2)) return;
      if (p0.startsWith('/.well-known/') && await oauth.handle(req, res, url)) return;
      if (p !== '/' && p !== '') { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'not found' })); }

      // ── MCP 엔드포인트 (prefix 자체, 예: /mcp) ──
      const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
      let api = oauth.resolve(m && m[1]);
      if (api && !api._oauth) { /* 프록시 토큰을 그대로 준 경우 — 세션을 열 때 한 번 진짜인지 확인한다 */
        const c = RAWOK.get(api.token); if (c && c.exp > Date.now()) api.id = c.id; else { try { const w = await api.whoami(); api.id = w.id; RAWOK.set(api.token, { id: w.id, exp: Date.now() + 5 * 60e3 }); } catch { api = null; } }
      }
      if (!api) { res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer resource_metadata="' + pub.origin + '/.well-known/oauth-protected-resource' + prefix + '"' }); return res.end(JSON.stringify({ error: 'unauthorized', hint: 'PUPASTAGE 계정으로 연결(OAuth)하거나 Authorization: Bearer <PUPA 토큰> 을 보내세요' })); }
      const sid = req.headers['mcp-session-id'];
      let s = sid && sessions.get(String(sid));
      if (s) { s.api = api; s.last = Date.now(); }
      if (req.method === 'POST') {
        const raw = await readBody(req); let body; try { body = JSON.parse(raw || '{}'); } catch { res.writeHead(400); return res.end('bad json'); }
        const isInit = body && body.method === 'initialize';
        if (!s) {
          if (!isInit) { /* 세션을 모름(서버 재시작 등) → 404 로 답해야 클라이언트가 스스로 다시 initialize 한다 (MCP 규격) */ res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'session not found — re-initialize' }, id: null })); }
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => { sessions.set(id, s); }, enableJsonResponse: false });
          s = { transport, api, last: Date.now() };
          s.server = createPupaServer((extra) => s.api);
          transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
          await s.server.connect(transport);
        }
        req.auth = { token: m[1], clientId: api._oauth ? 'oauth' : 'bearer', scopes: ['pupa'] };
        return s.transport.handleRequest(req, res, body);
      }
      if (req.method === 'GET' || req.method === 'DELETE') {
        if (!s) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'session not found' })); }
        req.auth = { token: m[1], clientId: 'bearer', scopes: ['pupa'] };
        return s.transport.handleRequest(req, res);
      }
      res.writeHead(405); res.end();
    } catch (e) { console.error('[pupa-mcp] 요청 오류', e); try { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message) })); } catch {} }
  });
  // 오래 논 세션 정리 (2시간)
  setInterval(() => { const cut = Date.now() - 2 * 3600e3; for (const [id, s] of sessions) if (s.last < cut) { try { s.transport.close(); } catch {} sessions.delete(id); } }, 600e3).unref();
  await new Promise(r => srv.listen(port, host, r));
  console.log('[pupa-mcp] http ' + host + ':' + port + '  public=' + publicUrl + '  proxy=' + proxyBase);
  return srv;
}

if (import.meta.url === 'file://' + process.argv[1] || process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  const mode = process.argv.includes('--http') ? 'http' : 'stdio';
  (mode === 'http' ? runHttp() : runStdio()).catch(e => { console.error('[pupa-mcp] 시작 실패', e); process.exit(1); });
}
