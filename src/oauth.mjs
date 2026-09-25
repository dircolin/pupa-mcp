// 최소 OAuth 2.1 인가 서버 — Claude.ai / ChatGPT 커넥터가 요구하는 흐름(동적 등록 + PKCE + 인가코드) 을
// PUPASTAGE 회원 로그인(아이디/비밀번호 → 프록시 /auth/login) 위에 얹는다.
// 발급되는 access_token 은 우리 서버 안에서만 뜻이 있는 무작위 값이고, 실제 프록시 토큰은 서버 파일에만 있다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PupaApi } from './pupa-api.mjs';

const b64u = (b) => Buffer.from(b).toString('base64url');
const rnd = (n = 32) => b64u(crypto.randomBytes(n));

export class OAuthStore {
  constructor(file) { this.file = file; this.d = { clients: {}, codes: {}, tokens: {}, refresh: {} }; this.load(); }
  load() { try { if (this.file && fs.existsSync(this.file)) this.d = Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch {} }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file + '.new', JSON.stringify(this.d), { mode: 0o600 }); fs.renameSync(this.file + '.new', this.file); } catch (e) { console.warn('[oauth] save fail', e.message); } }
  gc() { const now = Date.now(); for (const k of Object.keys(this.d.codes)) if (this.d.codes[k].exp < now) delete this.d.codes[k]; for (const k of Object.keys(this.d.tokens)) if (this.d.tokens[k].exp < now) delete this.d.tokens[k]; }
}

export function createOAuth({ issuer, store, proxyBase, resource }) {
  const meta = () => ({
    issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', registration_endpoint: issuer + '/register', revocation_endpoint: issuer + '/revoke',
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'], scopes_supported: ['pupa'], service_documentation: 'https://github.com/dircolin/pupa-mcp'
  });
  const prm = () => ({ resource, authorization_servers: [issuer], scopes_supported: ['pupa'], bearer_methods_supported: ['header'], resource_name: 'PUPA MCP' });

  function html(res, code, body) { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); }
  function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); }
  const page = (inner, title = 'PUPA 연결') => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;background:#0f1115;color:#e8e8ea;font-family:-apple-system,"Pretendard",system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}.card{width:min(420px,92vw);background:#181b22;border:1px solid #2a2f3a;border-radius:16px;padding:28px}h1{font-size:18px;margin:0 0 6px}p{color:#9aa0ad;font-size:13px;margin:0 0 18px;line-height:1.5}label{display:block;font-size:12px;color:#9aa0ad;margin:12px 0 6px}input{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid #2a2f3a;background:#0f1115;color:#fff;font-size:14px}button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:10px;background:#5b8cff;color:#fff;font-weight:800;font-size:14px;cursor:pointer}.err{color:#ff6b6b;font-size:12px;margin-top:10px}.who{font-size:12px;color:#9aa0ad;margin-top:14px}</style></head><body><div class="card">${inner}</div></body></html>`;

  async function handle(req, res, url) {
    const p = url.pathname;
    if (p === '/.well-known/oauth-authorization-server' || p.startsWith('/.well-known/oauth-authorization-server/')) return json(res, 200, meta()), true;
    if (p === '/.well-known/oauth-protected-resource' || p.startsWith('/.well-known/oauth-protected-resource/')) return json(res, 200, prm()), true;
    if (p === '/register' && req.method === 'POST') {
      let b = {}; try { b = JSON.parse(await readBody(req) || '{}'); } catch {}
      const id = 'c_' + rnd(12); const redirect_uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter(u => /^https?:\/\//.test(u)).slice(0, 10) : [];
      if (!redirect_uris.length) return json(res, 400, { error: 'invalid_client_metadata', error_description: 'redirect_uris required' }), true;
      store.d.clients[id] = { id, name: String(b.client_name || '').slice(0, 80), redirect_uris, ts: Date.now() }; store.save();
      return json(res, 201, { client_id: id, client_name: store.d.clients[id].name, redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }), true;
    }
    if (p === '/authorize') {
      const q = url.searchParams; const client = store.d.clients[q.get('client_id') || ''];
      const redirect = q.get('redirect_uri') || (client && client.redirect_uris[0]) || '';
      const bad = (m) => (html(res, 400, page(`<h1>연결할 수 없습니다</h1><p>${m}</p>`)), true);
      if (!client) return bad('client_id 를 모릅니다 — 커넥터를 다시 추가해 주세요');
      if (!client.redirect_uris.includes(redirect)) return bad('redirect_uri 가 등록된 값과 다릅니다');
      if (q.get('response_type') !== 'code') return bad('response_type=code 만 지원');
      if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return bad('PKCE(S256) 가 필요합니다');
      if (req.method === 'GET') {
        return html(res, 200, page(`<h1>PUPA 에 연결</h1><p><b>${esc(client.name || '이 앱')}</b> 이(가) 내 PUPASTAGE 계정으로 생성·저장할 수 있게 허용합니다. WOON 크레딧은 내 계정에서 차감됩니다.</p>
<form method="post"><input type="hidden" name="state" value="${esc(q.get('state') || '')}"><label>PUPASTAGE 아이디</label><input name="id" autocomplete="username" required autofocus><label>비밀번호</label><input name="pw" type="password" autocomplete="current-password" required><button>허용하고 연결</button><div class="who">회원 계정당 동시 기기 2대 — 이 연결도 1대로 칩니다.</div></form>`)), true;
      }
      if (req.method === 'POST') {
        const body = new URLSearchParams(await readBody(req)); const id = String(body.get('id') || '').trim(), pw = String(body.get('pw') || '');
        const api = new PupaApi({ base: proxyBase });
        try { await api.login(id, pw); } catch (e) { return html(res, 401, page(`<h1>로그인 실패</h1><p>${esc(e.message)}</p><p><a href="${esc(url.pathname + url.search)}" style="color:#5b8cff">다시 시도</a></p>`)), true; }
        const code = rnd(24);
        store.d.codes[code] = { client: client.id, redirect, challenge: q.get('code_challenge'), exp: Date.now() + 5 * 60e3, pupa: { token: api.token, rt: api.rt, id: api.id, base: api.base } }; store.save();
        const to = new URL(redirect); to.searchParams.set('code', code); const st = body.get('state') || q.get('state'); if (st) to.searchParams.set('state', st);
        res.writeHead(302, { location: to.toString(), 'cache-control': 'no-store' }); res.end(); return true;
      }
    }
    if (p === '/token' && req.method === 'POST') {
      const raw = await readBody(req); let b; try { b = /^\s*\{/.test(raw) ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); } catch { b = {}; }
      const bad = (e, d) => (json(res, 400, { error: e, error_description: d }), true);
      if (b.grant_type === 'authorization_code') {
        const c = store.d.codes[b.code || '']; if (!c || c.exp < Date.now()) return bad('invalid_grant', 'code 만료');
        if (b.client_id && b.client_id !== c.client) return bad('invalid_grant', 'client 불일치');
        if (b.redirect_uri && b.redirect_uri !== c.redirect) return bad('invalid_grant', 'redirect_uri 불일치');
        const ver = String(b.code_verifier || ''); if (!ver || b64u(crypto.createHash('sha256').update(ver).digest()) !== c.challenge) return bad('invalid_grant', 'PKCE 검증 실패');
        delete store.d.codes[b.code];
        const at = rnd(32), rt = rnd(32), exp = Date.now() + 30 * 24 * 3600e3;
        store.d.tokens[at] = { client: c.client, pupa: c.pupa, exp, rt }; store.d.refresh[rt] = { at, client: c.client, pupa: c.pupa, exp: Date.now() + 180 * 24 * 3600e3 }; store.gc(); store.save();
        return json(res, 200, { access_token: at, token_type: 'Bearer', expires_in: 30 * 24 * 3600, refresh_token: rt, scope: 'pupa' }), true;
      }
      if (b.grant_type === 'refresh_token') {
        const r = store.d.refresh[b.refresh_token || '']; if (!r || r.exp < Date.now()) return bad('invalid_grant', 'refresh 만료');
        delete store.d.tokens[r.at]; const at = rnd(32), exp = Date.now() + 30 * 24 * 3600e3; r.at = at; store.d.tokens[at] = { client: r.client, pupa: r.pupa, exp, rt: b.refresh_token }; store.save();
        return json(res, 200, { access_token: at, token_type: 'Bearer', expires_in: 30 * 24 * 3600, refresh_token: b.refresh_token, scope: 'pupa' }), true;
      }
      return bad('unsupported_grant_type', '');
    }
    if (p === '/revoke' && req.method === 'POST') { const raw = await readBody(req); const b = Object.fromEntries(new URLSearchParams(raw)); const t = b.token || ''; if (store.d.tokens[t]) { delete store.d.refresh[store.d.tokens[t].rt]; delete store.d.tokens[t]; } if (store.d.refresh[t]) { delete store.d.tokens[store.d.refresh[t].at]; delete store.d.refresh[t]; } store.save(); return json(res, 200, {}), true; }
    return false;
  }
  /** Bearer → PupaApi (OAuth 토큰이면 저장된 프록시 세션, 아니면 프록시 토큰 그대로) */
  function resolve(bearer) {
    if (!bearer) return null;
    const t = store.d.tokens[bearer];
    if (t) { if (t.exp < Date.now()) return null; const api = new PupaApi(Object.assign({}, t.pupa, { onToken: (a) => { t.pupa = { token: a.token, rt: a.rt, id: a.id, base: a.base }; store.save(); } })); api._oauth = true; return api; }
    return new PupaApi({ base: proxyBase, token: bearer });
  }
  return { handle, resolve, meta, prm };
}

export function readBody(req) { return new Promise((resolve, reject) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); req.on('error', reject); }); }
const esc = (s) => String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
