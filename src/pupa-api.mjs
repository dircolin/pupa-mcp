// PUPA 프록시(proxy.pupastage.com) 클라이언트 — 회원 토큰(Bearer)으로 생성·과금·저장을 중계한다.
// 공급자 키는 서버에만 있다. 이 모듈은 절대 공급자 키를 만지지 않는다.
import fs from 'node:fs';

export const DEFAULT_BASE = process.env.PUPA_PROXY_BASE || 'https://proxy.pupastage.com';

export class PupaError extends Error {
  constructor(status, body, msg) { super(msg || (body && body.error) || ('HTTP ' + status)); this.status = status; this.body = body || {}; }
}

export class PupaApi {
  constructor({ base = DEFAULT_BASE, token = '', rt = '', id = '', onToken } = {}) {
    this.base = String(base).replace(/\/+$/, '');
    this.token = token; this.rt = rt; this.id = id; this.onToken = onToken;
  }
  async _req(method, path, { body, headers = {}, raw = false, timeoutMs = 120000, retry401 = true } = {}) {
    const h = Object.assign({}, headers);
    if (this.token) h['authorization'] = 'Bearer ' + this.token;
    let payload;
    if (body != null) { if (Buffer.isBuffer(body) || typeof body === 'string') payload = body; else { payload = JSON.stringify(body); h['content-type'] = h['content-type'] || 'application/json'; } }
    const r = await fetch(this.base + path, { method, headers: h, body: payload, signal: AbortSignal.timeout(timeoutMs) });
    const ct = String(r.headers.get('content-type') || '');
    let out;
    if (raw) out = Buffer.from(await r.arrayBuffer());
    else if (/json/.test(ct)) { try { out = await r.json(); } catch { out = {}; } }
    else out = await r.text();
    if (r.status === 401 && retry401 && this.rt) {
      const ok = await this.refresh().catch(() => false);
      if (ok) return this._req(method, path, { body, headers, raw, timeoutMs, retry401: false });
    }
    if (!r.ok) throw new PupaError(r.status, typeof out === 'object' ? out : { error: String(out).slice(0, 300) });
    const meta = { cost: +r.headers.get('x-pupa-cost') || 0, balance: r.headers.get('x-pupa-balance') != null ? +r.headers.get('x-pupa-balance') : null };
    return { data: out, meta, status: r.status };
  }
  async login(id, pw) {
    const { data } = await this._req('POST', '/auth/login', { body: { id, pw }, retry401: false });
    this.token = data.token; this.rt = data.rt || ''; this.id = data.id;
    if (this.onToken) try { this.onToken(this); } catch {}
    return data;
  }
  async refresh() {
    if (!this.rt) return false;
    const { data } = await this._req('POST', '/auth/refresh', { body: { rt: this.rt }, retry401: false });
    this.token = data.token; this.id = data.id;
    if (this.onToken) try { this.onToken(this); } catch {}
    return true;
  }
  whoami() { return this._req('GET', '/whoami').then(r => r.data); }
  credit() { return this._req('GET', '/credit').then(r => r.data); }
  pricingSpec() { return this._req('GET', '/pricing-spec').then(r => r.data); }
  ledger() { return this._req('GET', '/ledger').then(r => r.data); }
  jobsMine() { return this._req('GET', '/job/mine').then(r => r.data); }
  jobStatus(id) { return this._req('GET', '/job/status?id=' + encodeURIComponent(id)).then(r => r.data); }
  /** fal 큐 제출 — 서버가 본문을 보고 WOON 을 선차감한다 (실패 시 서버가 자동 환불) */
  falSubmit(app, input) { return this._req('POST', '/relay/falq/' + app.replace(/^\/+/, ''), { body: input }); }
  falStatus(app, requestId) { return this._req('GET', '/relay/falq/' + app.replace(/^\/+/, '') + '/requests/' + requestId + '/status').then(r => r.data); }
  falResult(app, requestId) { return this._req('GET', '/relay/falq/' + app.replace(/^\/+/, '') + '/requests/' + requestId).then(r => r.data); }
  /** PiAPI task 제출 — /task 만 과금 */
  piapiSubmit(body) { return this._req('POST', '/relay/piapi/api/v1/task', { body }); }
  piapiTask(id) { return this._req('GET', '/relay/piapi/api/v1/task/' + encodeURIComponent(id)).then(r => r.data); }
  /** 결과를 회원 작업 이력(작업↔전표)에 등록 — PUWU 화면에 보인다 */
  jobRegister(rec) { return this._req('POST', '/job/register', { body: rec }).then(r => r.data); }
  /** 영구 에셋 보관 (레퍼런스·결과물) */
  assetStore({ url, data }) { return this._req('POST', '/pupa/asset', { body: url ? { url } : { data } }).then(r => r.data); }
  projList() { return this._req('GET', '/proj/list').then(r => r.data); }
  projGet(id) { return this._req('GET', '/proj/get?id=' + encodeURIComponent(id)).then(r => r.data); }
  projSave(rec) { return this._req('POST', '/proj/save', { body: rec }).then(r => r.data); }
}

/** 파일에 토큰을 보관 (stdio 모드용, 0600) */
export function loadTokenFile(fp) {
  try { if (fp && fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch {}
  return null;
}
export function saveTokenFile(fp, api) {
  if (!fp) return;
  try { fs.mkdirSync(require_dirname(fp), { recursive: true }); } catch {}
  try { fs.writeFileSync(fp, JSON.stringify({ base: api.base, token: api.token, rt: api.rt, id: api.id, ts: Date.now() }), { mode: 0o600 }); } catch {}
}
function require_dirname(p) { const i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : '.'; }
