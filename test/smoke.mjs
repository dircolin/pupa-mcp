// 스모크 테스트 — 가짜 PUPA 프록시를 띄우고, MCP 서버(http)를 띄운 뒤, MCP 클라이언트로 도구·OAuth 흐름을 끝까지 돌린다. 실제 크레딧 0.
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { runHttp } from '../src/server.mjs';
import { parseScreenplay, toStandardMd } from '../src/parser.mjs';
import { planScene } from '../src/shotplan.mjs';

const body = (req) => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString())); });
const J = (res, code, o, h = {}) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json' }, h)); res.end(JSON.stringify(o)); };
let balance = 500; const jobs = []; const projs = [];
const mock = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname; const auth = req.headers.authorization || '';
  if (p === '/auth/login') { const b = JSON.parse(await body(req)); if (b.id === 'tester' && b.pw === 'pw1234') return J(res, 200, { token: 'TOK1', id: 'tester', role: 'member', balance, rt: 'RT1' }); return J(res, 401, { error: '아이디 또는 비밀번호가 올바르지 않습니다' }); }
  if (p === '/auth/refresh') return J(res, 200, { token: 'TOK2', id: 'tester', balance });
  if (auth !== 'Bearer TOK1' && auth !== 'Bearer TOK2') return J(res, 401, { error: '로그인이 필요합니다', code: 'AUTH' });
  if (p === '/whoami') return J(res, 200, { ok: true, id: 'tester', role: 'member', name: '테스터', group: '' });
  if (p === '/credit') return J(res, 200, { balance });
  if (p === '/pricing-spec') return J(res, 200, { version: 49, wonPerCredit: 200, video: { seed25: { label: 'Seedance 2.5', durations: [5, 10, 15], resolutions: ['720p', '1080p'], woon: { '720p': { 5: 26, 10: 51, 15: 77 }, '1080p': { 5: 59, 10: 117, 15: 176 } } } }, image: { gpt_img2: { label: 'GPT Image 2', woon: 3 }, nb: { label: 'Nano Banana Pro', woon: 3 } } });
  if (p === '/ledger') return J(res, 200, [{ ts: Date.now(), reason: 'gen', delta: -26, docno: '2026-09-000001', eng: 'Seedance 2.5', dur: '5' }]);
  if (p === '/job/mine') return J(res, 200, { jobs });
  if (p === '/job/register') { const b = JSON.parse(await body(req)); jobs.push(Object.assign({ id: 'j' + jobs.length, ts: Date.now() }, b)); return J(res, 200, { ok: true, jobId: 'j' + (jobs.length - 1) }); }
  if (p === '/pupa/asset') { const b = JSON.parse(await body(req)); return J(res, 200, { ok: true, url: 'https://proxy.test/pupa/asset/kept_' + crypto.createHash('md5').update(String(b.url || b.data)).digest('hex').slice(0, 8) + '.png' }); }
  if (p === '/proj/save') { const b = JSON.parse(await body(req)); const id = 'p' + (projs.length + 1); projs.push(Object.assign({ id }, b)); return J(res, 200, { ok: true, id, kind: b.kind, title: b.title }); }
  if (p.startsWith('/relay/falq/')) {
    const rest = p.replace('/relay/falq/', '');
    if (req.method === 'POST') { const b = JSON.parse(await body(req)); const cost = /seedance/.test(rest) ? 59 : 3; balance -= cost; return J(res, 200, { request_id: 'r' + Date.now(), status: 'IN_QUEUE', _app: rest, _in: b }, { 'x-pupa-cost': String(cost), 'x-pupa-balance': String(balance) }); }
    if (/\/requests\/[^/]+\/status$/.test(rest)) return J(res, 200, { status: 'COMPLETED' });
    if (/\/requests\/[^/]+$/.test(rest)) return J(res, 200, /seedance/.test(rest) ? { video: { url: 'https://fal.test/out.mp4' } } : { images: [{ url: 'https://fal.test/out.png' }] });
  }
  if (p === '/relay/piapi/api/v1/task' && req.method === 'POST') { const b = JSON.parse(await body(req)); balance -= 3; return J(res, 200, { code: 200, data: { task_id: 't' + Date.now(), status: 'pending', _body: b } }, { 'x-pupa-cost': '3', 'x-pupa-balance': String(balance) }); }
  if (p.startsWith('/relay/piapi/api/v1/task/')) return J(res, 200, { code: 200, data: { status: 'completed', output: { image_url: 'https://piapi.test/out.png' } } });
  J(res, 404, { error: 'mock: ' + p });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r)); const MOCK = 'http://127.0.0.1:' + mock.address().port;
const PORT = 18790 + Math.floor(Math.random() * 500); const PUB = 'http://127.0.0.1:' + PORT + '/mcp';
const srv = await runHttp({ port: PORT, host: '127.0.0.1', publicUrl: PUB, proxyBase: MOCK, dataDir: '/tmp/pupa-mcp-test-' + PORT });

// ── 1) 파서·플래너 단위 ──
const SAMPLE = `# 비 오는 골목\n\n- **장르**: 드라마\n\n## 등장인물\n\n- **민준** (남, 30대) — 우유부단\n- **수아** (여, 30대) — 생활력\n\n## S1. 골목_밤 [NORMAL] (실외)\n\n### C1.\n\n- [서술] 비 오는 골목, 민준이 우산 없이 걸어온다. (3초)\n\n### C2.\n\n- [서술] 수아가 문 앞에 서 있다. 두 사람이 마주 본다.\n\n### C3.\n\n- **[대사]** 수아: "왜 이제 왔어."\n\n### C4.\n\n- **[대사]** 민준: "…미안."\n\n### C5.\n\n- **[대사]** 수아 (떨며): "미안하면 다야? 나는 여기서 세 시간을 기다렸어."\n- **[사운드]** 빗소리\n\n### C6.\n\n- [서술] 수아가 돌아서 멀어져 간다.\n`;
const d = parseScreenplay(SAMPLE); assert.equal(d.format, 'standard'); assert.equal(d.scenes.length, 1); assert.equal(d.scenes[0].cuts.length, 6); assert.equal(d.characters.length, 2); assert.equal(d.scenes[0].cuts[4].dialogue[0].dir, '떨며');
const plan = planScene(d.scenes[0], 'story'); assert.equal(plan[0].size, 'WS'); assert.equal(plan[3].size, 'CU'); assert.equal(plan[4].angle, 'OTS'); assert.equal(plan[5].angle, 'Back View');
const FREE = `광고: 샴푸\n\nS#1 욕실 - 아침\n나연이 거울 앞에서 푸석한 머리를 만진다.\n나연: 아침마다 이러기 싫다.\n\nS#2 욕실 - 아침\n샴푸 병 클로즈업, 라벨이 카메라를 향한다.\n나연이 샴푸를 손에 덜어 머리를 감는다.\n나연: 이제 아침이 기다려져.\n`;
const f = parseScreenplay(FREE); assert.equal(f.format, 'free'); assert.equal(f.scenes.length, 2); assert.ok(f.scenes[0].cuts.some(c => c.dialogue.length)); assert.ok(/## S1\./.test(toStandardMd(f)));
console.log('✓ parser/planner');

// ── 2) OAuth 흐름 (동적 등록 → 인가 → 토큰) ──
const reg = await (await fetch(PUB + '/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Smoke', redirect_uris: ['http://localhost:9/cb'] }) })).json(); assert.ok(reg.client_id);
const meta = await (await fetch('http://127.0.0.1:' + PORT + '/.well-known/oauth-authorization-server/mcp')).json(); assert.equal(meta.authorization_endpoint, PUB + '/authorize');
const verifier = 'v'.repeat(48), challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const aq = '?client_id=' + reg.client_id + '&redirect_uri=' + encodeURIComponent('http://localhost:9/cb') + '&response_type=code&code_challenge=' + challenge + '&code_challenge_method=S256&state=xyz';
assert.equal((await fetch(PUB + '/authorize' + aq)).status, 200);
const r302 = await fetch(PUB + '/authorize' + aq, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'id=tester&pw=pw1234&state=xyz', redirect: 'manual' }); assert.equal(r302.status, 302);
const code = new URL(r302.headers.get('location')).searchParams.get('code'); assert.ok(code);
const tok = await (await fetch(PUB + '/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: 'http://localhost:9/cb' }) })).json(); assert.ok(tok.access_token);
const bad = await fetch(PUB, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(bad.status, 401); assert.ok(/resource_metadata/.test(bad.headers.get('www-authenticate')));
console.log('✓ oauth');

// ── 3) MCP 클라이언트로 도구 호출 ──
async function run(bearer) {
  const client = new Client({ name: 'smoke', version: '0' });
  const tr = new StreamableHTTPClientTransport(new URL(PUB), { requestInit: { headers: { authorization: 'Bearer ' + bearer } } });
  await client.connect(tr);
  const tools = (await client.listTools()).tools.map(t => t.name); assert.ok(tools.includes('pupa_generate_video') && tools.includes('pupa_plan_shots'));
  const who = JSON.parse((await client.callTool({ name: 'pupa_whoami', arguments: {} })).content[0].text); assert.equal(who.id, 'tester');
  const pr0 = JSON.parse((await client.callTool({ name: 'pupa_pricing', arguments: { kind: 'all' } })).content[0].text); assert.equal(pr0.video.seed25.woon['1080p'][15], 176); assert.equal(pr0.image.nb.woon, 3);
  const parsed = JSON.parse((await client.callTool({ name: 'pupa_parse_screenplay', arguments: { text: SAMPLE } })).content[0].text); assert.equal(parsed.stats.cuts, 6);
  const shots = JSON.parse((await client.callTool({ name: 'pupa_plan_shots', arguments: { doc: parsed.doc, total_seconds: 15 } })).content[0].text); assert.equal(shots.genre, 'story'); assert.equal(shots.scenes[0].cuts.length, 6); assert.ok(/Hard cut to\./.test(shots.scenes[0].cuts[0].prompt_skeleton_en)); assert.ok(Math.abs(shots.scenes[0].total_sec - 15) < 0.01);
  const img = JSON.parse((await client.callTool({ name: 'pupa_generate_image', arguments: { engine: 'gpt_img2', prompt: 'character sheet of 민준', aspect_ratio: '16:9', hires: true } })).content[0].text); assert.ok(/kept_/.test(img.url)); assert.equal(img.woon_charged, 3);
  const nb = JSON.parse((await client.callTool({ name: 'pupa_generate_image', arguments: { engine: 'nb', prompt: 'same character, bust shot', reference_urls: [img.url] } })).content[0].text); assert.ok(nb.url);
  const vid = JSON.parse((await client.callTool({ name: 'pupa_generate_video', arguments: { engine: 'seed25', prompt: shots.scenes[0].cuts.map(c => c.prompt_skeleton_en).join('\n'), duration: 15, resolution: '1080p', image_urls: [img.url] } })).content[0].text); assert.ok(vid.job_id.startsWith('fal:bytedance/seedance-2.5:')); assert.equal(vid.mode, 'reference-to-video'); assert.equal(vid.woon_charged, 59);
  const st = JSON.parse((await client.callTool({ name: 'pupa_job_status', arguments: { job_id: vid.job_id } })).content[0].text); assert.equal(st.status, 'completed'); assert.ok(/kept_/.test(st.url));
  const sv = JSON.parse((await client.callTool({ name: 'pupa_save_scenario', arguments: { title: '테스트', standard_md: parsed.standard_md } })).content[0].text); assert.ok(sv.ok);
  const jl = JSON.parse((await client.callTool({ name: 'pupa_jobs', arguments: {} })).content[0].text); assert.ok(jl.length >= 3);
  const pr = await client.getPrompt({ name: 'pupa_ad_director', arguments: { brand: '테스트 브랜드' } }); assert.ok(/pupa_plan_shots/.test(pr.messages[0].content.text));
  const rs = await client.readResource({ uri: 'pupa://rules' }); assert.ok(/브랜드 노출 1순위/.test(rs.contents[0].text));
  await client.close();
}
await run(tok.access_token); console.log('✓ mcp tools (oauth token)');
await run('TOK1'); console.log('✓ mcp tools (raw pupa token)');
console.log('jobs registered:', jobs.length, '| projects saved:', projs.length, '| balance:', balance);
srv.close(); mock.close(); process.exit(0);
