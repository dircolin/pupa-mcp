// MCP 도구 정의 — Claude / ChatGPT / Cursor 가 호출한다.
// 생성·과금은 전부 PUPA 프록시(/relay/*)를 지난다 → 회원 원장(전표)에 그대로 남고, 공급자 키는 서버에만 있다.
import { z } from 'zod';
import { parseScreenplay, toStandardMd } from './parser.mjs';
import { planScene, detectGenre, rulesFor, cutPromptSkeleton, RULES } from './shotplan.mjs';
import { PupaError } from './pupa-api.mjs';

export const VIDEO_ENGINES = {
  seed25: { label: 'Seedance 2.5', route: 'fal', app: 'bytedance/seedance-2.5', durations: [5, 10, 15, 20, 25, 30], resolutions: ['480p', '720p', '1080p'], maxImages: 9, video: true, audio: true },
  seed20: { label: 'Seedance 2.0 Pro', route: 'fal', app: 'bytedance/seedance-2.0', durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutions: ['480p', '720p', '1080p'], maxImages: 9, video: true, audio: true },
  seed15: { label: 'Seedance 2.0 Fast', route: 'fal', app: 'bytedance/seedance-2.0/fast', durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutions: ['480p', '720p', '1080p'], maxImages: 9, video: true, audio: true },
  seedmini: { label: 'Seedance 2.0 Mini', route: 'fal', app: 'bytedance/seedance-2.0/mini', durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutions: ['480p', '720p'], maxImages: 9, video: true, audio: true },
  kling30: { label: 'Kling 3.0 (PiAPI)', route: 'piapi', model: 'kling', task_type: 'video_generation', extra: { mode: 'pro', version: '3.0' }, durations: [5, 10, 15], resolutions: ['1080p'], maxImages: 1, video: false, audio: false }
};
export const IMAGE_ENGINES = {
  gpt_img2: { label: 'GPT Image 2 (fal)', route: 'fal', app: 'openai/gpt-image-2', editApp: 'openai/gpt-image-2/edit', maxRefs: 8 },
  nb: { label: 'Nano Banana Pro (PiAPI)', route: 'piapi', model: 'gemini', task_type: 'nano-banana-pro', maxRefs: 9 },
  nb2: { label: 'Nano Banana 2 (PiAPI)', route: 'piapi', model: 'gemini', task_type: 'nano-banana-2', maxRefs: 9 },
  seedream: { label: 'Seedream 5 Pro 2K (PiAPI)', route: 'piapi', model: 'seedream', task_type: 'seedream-5-pro-less-restriction', maxRefs: 10 }
};
const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 1) }] });
const err = (e) => ({ isError: true, content: [{ type: 'text', text: '오류: ' + (e && e.message ? e.message : String(e)) + (e instanceof PupaError && e.status === 402 ? ' — WOON 크레딧이 부족합니다. PUPASTAGE 에서 충전하세요.' : '') }] });

function gptSize(aspect, hires) {
  const map = { '16:9': ['landscape_16_9', [2048, 1152]], '9:16': ['portrait_16_9', [1152, 2048]], '1:1': ['square_hd', [1536, 1536]], '4:3': ['landscape_4_3', [2048, 1536]], '3:4': ['portrait_4_3', [1536, 2048]], '21:9': ['landscape_16_9', [2688, 1152]] };
  const m = map[aspect] || map['16:9'];
  return hires ? { width: m[1][0], height: m[1][1] } : m[0];
}

/** server: McpServer, getApi: (extra) => PupaApi  */
export function registerTools(server, getApi) {
  const api = (extra) => { const a = getApi(extra); if (!a || !a.token) throw new Error('PUPA 로그인이 필요합니다 (Bearer 토큰 없음)'); return a; };

  server.registerTool('pupa_whoami', {
    title: '내 PUPA 계정·잔액', description: '로그인된 PUPASTAGE 회원 정보와 WOON 잔액을 돌려준다. 생성 도구를 쓰기 전에 잔액을 확인할 때 쓴다.',
    inputSchema: {}
  }, async (_a, extra) => { try { const A = api(extra); const [w, c] = await Promise.all([A.whoami(), A.credit()]); return text({ id: w.id, name: w.name, role: w.role, group: w.group, balance_woon: c.balance, note: '1 WOON ≈ ₩200' }); } catch (e) { return err(e); } });

  server.registerTool('pupa_pricing', {
    title: '엔진별 WOON 요금표', description: '영상 엔진(초수×해상도)·이미지 엔진의 판매 WOON 요금표(회사 요금 원장 기준, 실시간). 생성 전에 비용을 미리 알려줄 때 쓴다.',
    inputSchema: { kind: z.enum(['video', 'image', 'all']).default('all').describe('video | image | all') }
  }, async ({ kind }, extra) => { try { const A = api(extra); const p = await A.pricingSpec(); const V = p.video || p, I = p.image || p.img || {}; const out = { version: p.version, effectiveAt: p.effectiveAt }; if (kind !== 'image') { out.video = {}; for (const k of Object.keys(VIDEO_ENGINES)) if (V[k]) out.video[k] = V[k]; } if (kind !== 'video') { out.image = {}; const AL = { gpt_img2: 'gpt_image_2' }; for (const k of Object.keys(IMAGE_ENGINES)) { const v = I[k] || I[AL[k]]; if (v) out.image[k] = v; } } out.note = 'video[엔진].woon[해상도][초수] = 판매 WOON / image[엔진].woon = 장당. 1 WOON ≈ ₩' + (p.wonPerCredit || 200); return text(out); } catch (e) { return err(e); } });

  server.registerTool('pupa_parse_screenplay', {
    title: '시나리오 → 씬/컷 구조', description: '한국어 시나리오·콘티·대본(자유 형식 또는 PUWU 표준 MD)을 씬·컷·대사·자료·사운드 구조(JSON)와 PUWU 표준 MD 로 바꾼다. 크레딧 0. 결과의 standard_md 는 PUPASTAGE 스튜디오가 그대로 읽는다.',
    inputSchema: { text: z.string().min(10).describe('시나리오 본문'), title: z.string().optional(), genre: z.string().optional().describe('예: 광고, 드라마, 스릴러') }
  }, async ({ text: t, title, genre }) => { try { const d = parseScreenplay(t); if (title) d.title = title; if (genre) d.genre = genre; return text({ stats: d.stats, format_detected: d.format, genre: detectGenre(d), doc: d, standard_md: toStandardMd(d) }); } catch (e) { return err(e); } });

  server.registerTool('pupa_plan_shots', {
    title: '샷 플랜(사이즈·앵글·무빙·초수)', description: 'PUPA 샷 플래너: 씬의 흐름(오프닝→관계→갈등→정점→여운, 광고는 후크→문제→제품→근거→포인트→팩샷)에 따라 컷마다 샷 사이즈·앵글·카메라 무빙·렌즈·초수·이유를 정한다. LLM 을 쓰지 않아 크레딧 0. 결과에는 각 컷의 영어 프롬프트 뼈대와 장르 규칙이 포함된다 — 이 뼈대를 채워 pupa_generate_video 에 넣는다.',
    inputSchema: { text: z.string().optional().describe('시나리오 본문(파싱 포함) — doc 을 주면 생략'), doc: z.any().optional().describe('pupa_parse_screenplay 의 doc'), genre: z.enum(['auto', 'ad', 'story']).default('auto'), total_seconds: z.number().optional().describe('씬 하나를 이 길이에 맞춰 초수 배분(선택)'), scene: z.number().optional().describe('특정 씬 번호만') }
  }, async ({ text: t, doc, genre, total_seconds, scene }) => {
    try {
      const d = doc || (t ? parseScreenplay(t) : null); if (!d) throw new Error('text 또는 doc 이 필요합니다');
      const g = genre === 'auto' ? detectGenre(d) : genre;
      const scenes = (d.scenes || []).filter(s => !scene || s.n === scene);
      const out = scenes.map(s => { const plan = planScene(s, g, { totalSeconds: total_seconds }); return { scene: s.n, title: s.title, purpose_hint: g === 'ad' ? '브랜드 노출·슬로건 완성' : '(이 씬이 이야기에서 해내야 할 일을 한 문장으로 정할 것)', total_sec: plan.reduce((a, p) => a + p.sec, 0), cuts: s.cuts.map((c, i) => ({ n: c.n, sec: plan[i].sec, t: plan[i].t0 + 's-' + plan[i].t1 + 's', size: plan[i].size, angle: plan[i].angle, move: plan[i].move, lens: plan[i].lens, why: plan[i].why, pack_shot: !!plan[i].packShot, content: c.content, dialogue: c.dialogue, archive: c.archive, prompt_skeleton_en: cutPromptSkeleton(s, c, plan[i], g) })) }; });
      return text({ genre: g, rules_ko: rulesFor(g), clip_rules_en: RULES.clip_en.join('\n') + '\n' + (g === 'ad' ? RULES.ad_en : RULES.story_en), scenes: out, how_to_use: '컷마다 prompt_skeleton_en 을 바탕으로 영어 프롬프트를 완성(한국어 대사는 큰따옴표 그대로)한 뒤, 한 씬을 한 편으로 만들려면 컷들을 "Hard cut to." 로 이어 붙여 pupa_generate_video(duration=total_sec 반올림) 에 넣는다.' });
    } catch (e) { return err(e); }
  });

  server.registerTool('pupa_prompt_rules', {
    title: '광고/이야기/클립 프롬프트 규칙', description: 'PUPA 의 구성 규칙 원문 — 광고(브랜드 1순위·슬로건↔대사·아크·팩샷), 이야기(씬의 목적·흐름·앵글 의미·대사 표현·컷 분할·대사 길이), 클립(타임코드·Hard cut·이어받기·손 규칙·품질 접미). 프롬프트를 쓰기 전에 읽는다.',
    inputSchema: { kind: z.enum(['ad', 'story', 'clip', 'all']).default('all') }
  }, async ({ kind }) => text(rulesFor(kind)));

  server.registerTool('pupa_generate_image', {
    title: '이미지 생성 (WOON 차감)', description: '컷 이미지·캐릭터 시트·제품 컷 생성. 엔진: gpt_img2(GPT Image 2, 레퍼런스 편집 강함), nb(Nano Banana Pro 2K), nb2, seedream(Seedream 5 Pro 2K, 인물 일관성). reference_urls 를 주면 그 얼굴·제품·스타일을 따른다(캐릭터 북). 비용은 pupa_pricing 참고. 완료까지 대기하고 URL 을 돌려준다.',
    inputSchema: { engine: z.enum(Object.keys(IMAGE_ENGINES)).default('gpt_img2'), prompt: z.string().min(3), aspect_ratio: z.enum(ASPECTS).default('16:9'), reference_urls: z.array(z.string().url()).max(10).optional().describe('캐릭터/제품/스타일 레퍼런스 이미지 URL'), hires: z.boolean().default(false).describe('GPT Image 2 를 2K 로'), label: z.string().optional().describe('작업 이력에 남길 이름(예: S1 C3)') }
  }, async ({ engine, prompt, aspect_ratio, reference_urls, hires, label }, extra) => {
    try {
      const A = api(extra); const E = IMAGE_ENGINES[engine]; const refs = (reference_urls || []).slice(0, E.maxRefs);
      let url = '', cost = 0, balance = null, taskId = '';
      if (E.route === 'fal') {
        const input = { prompt, num_images: 1, quality: 'high', image_size: refs.length ? 'auto' : gptSize(aspect_ratio, hires) };
        if (refs.length) { input.image_urls = refs; input.input_fidelity = 'high'; if (hires) input.image_size = gptSize(aspect_ratio, true); }
        const app = refs.length ? E.editApp : E.app;
        const sub = await A.falSubmit(app, input); cost = sub.meta.cost; balance = sub.meta.balance; taskId = sub.data.request_id;
        if (!taskId) throw new Error('fal request_id 없음: ' + JSON.stringify(sub.data).slice(0, 200));
        let res = null; try { res = await waitFal(A, E.app, taskId, 150000); } catch (e2) { if (/시간 초과/.test(e2.message)) { const jid = 'fal:' + E.app + ':' + taskId; PENDING.set(jid, { engine, prompt, label: label || '', cost, ts: Date.now(), kind: 'image' }); return text({ status: 'in_progress', job_id: jid, woon_charged: cost, next: 'pupa_job_status(job_id, wait_seconds=30) 로 확인' }); } throw e2; }
        url = res && res.images && res.images[0] && res.images[0].url || '';
      } else {
        const input = { prompt, output_format: 'png', aspect_ratio, safety_level: 'high' };
        if (engine === 'seedream') { input.size = '2K'; if (refs.length) input.image = refs; }
        else { input.resolution = '2K'; if (refs.length) input.image_urls = refs; }
        const body = { model: E.model, task_type: E.task_type, input, config: { service_mode: 'public' }, _pupaEng: engine };
        const sub = await A.piapiSubmit(body); cost = sub.meta.cost; balance = sub.meta.balance; taskId = sub.data && sub.data.data && sub.data.data.task_id;
        if (!taskId) throw new Error('PiAPI task_id 없음: ' + JSON.stringify(sub.data).slice(0, 200));
        let res = null; try { res = await waitPiapi(A, taskId, 150000); } catch (e2) { if (/시간 초과/.test(e2.message)) { const jid = 'piapi:' + taskId; PENDING.set(jid, { engine, prompt, label: label || '', cost, ts: Date.now(), kind: 'image' }); return text({ status: 'in_progress', job_id: jid, woon_charged: cost, next: 'pupa_job_status(job_id, wait_seconds=30) 로 확인' }); } throw e2; }
        url = pickPiapiUrl(res);
      }
      if (!url) throw new Error('결과 이미지 URL 없음');
      let kept = url; try { const st = await A.assetStore({ url }); if (st && st.url) kept = st.url; } catch {}
      try { await A.jobRegister({ provider: E.route, taskId, kind: 'image', engine, engineName: E.label + (label ? ' · ' + label : ''), prompt: prompt.slice(0, 2000), status: 'completed', resultUrl: kept, cost }); } catch {}
      return text({ url: kept, engine, woon_charged: cost, balance_after: balance, note: 'PUPASTAGE 작업 이력에 등록됨' });
    } catch (e) { return err(e); }
  });

  server.registerTool('pupa_generate_video', {
    title: '영상 생성 제출 (WOON 차감)', description: '컷/씬 영상 생성을 제출하고 job 을 돌려준다(완료는 pupa_job_status 로 확인, 보통 2~6분). 엔진: seed25(Seedance 2.5, 최대 30초·1080p·이미지9+영상3+오디오3 레퍼런스·오디오 네이티브), seed20/seed15/seedmini, kling30(PiAPI, 시작/끝 프레임). image_urls 에 캐릭터 시트·제품·시작 프레임을 넣으면 얼굴·제품이 유지된다. 프롬프트는 pupa_plan_shots 의 뼈대 + pupa_prompt_rules(clip) 를 따른다.',
    inputSchema: { engine: z.enum(Object.keys(VIDEO_ENGINES)).default('seed25'), prompt: z.string().min(10), duration: z.number().int().min(4).max(30).default(10), resolution: z.enum(['480p', '720p', '1080p']).default('1080p'), aspect_ratio: z.enum(ASPECTS).default('16:9'), image_urls: z.array(z.string().url()).max(9).optional().describe('레퍼런스/시작 프레임 이미지'), start_image_url: z.string().url().optional().describe('첫 프레임으로 고정할 이미지(Seedance image-to-video / Kling)'), end_image_url: z.string().url().optional().describe('끝 프레임(Kling)'), video_urls: z.array(z.string().url()).max(3).optional(), audio_urls: z.array(z.string().url()).max(3).optional(), generate_audio: z.boolean().default(true), label: z.string().optional() }
  }, async (p, extra) => {
    try {
      const A = api(extra); const E = VIDEO_ENGINES[p.engine];
      const dur = nearest(E.durations, p.duration); const res = E.resolutions.includes(p.resolution) ? p.resolution : E.resolutions[E.resolutions.length - 1];
      let job;
      if (E.route === 'fal') {
        const input = { prompt: p.prompt, duration: String(dur), aspect_ratio: p.aspect_ratio, resolution: res, generate_audio: !!p.generate_audio };
        let sub = 'text-to-video';
        if (p.start_image_url && !(p.image_urls && p.image_urls.length) && !(p.video_urls && p.video_urls.length)) { sub = 'image-to-video'; input.image_url = p.start_image_url; }
        else if ((p.image_urls && p.image_urls.length) || (p.video_urls && p.video_urls.length) || (p.audio_urls && p.audio_urls.length)) { sub = 'reference-to-video'; input.image_urls = [].concat(p.start_image_url ? [p.start_image_url] : [], p.image_urls || []).slice(0, E.maxImages); if (p.video_urls && p.video_urls.length) input.video_urls = p.video_urls.slice(0, 3); if (p.audio_urls && p.audio_urls.length) input.audio_urls = p.audio_urls.slice(0, 3); }
        const r = await A.falSubmit(E.app + '/' + sub, input);
        if (!r.data.request_id) throw new Error('fal request_id 없음: ' + JSON.stringify(r.data).slice(0, 200));
        job = { job_id: 'fal:' + E.app + ':' + r.data.request_id, engine: p.engine, woon_charged: r.meta.cost, balance_after: r.meta.balance, mode: sub, duration: dur, resolution: res };
      } else {
        const input = Object.assign({ prompt: p.prompt, duration: dur, aspect_ratio: p.aspect_ratio, cfg_scale: 0.5 }, E.extra);
        const start = p.start_image_url || (p.image_urls && p.image_urls[0]); if (start) input.image_url = start; if (p.end_image_url) input.image_tail_url = p.end_image_url;
        const body = { model: E.model, task_type: E.task_type, input, config: { service_mode: 'public' }, _pupaEng: p.engine };
        const r = await A.piapiSubmit(body); const tid = r.data && r.data.data && r.data.data.task_id;
        if (!tid) throw new Error('PiAPI task_id 없음: ' + JSON.stringify(r.data).slice(0, 200));
        job = { job_id: 'piapi:' + tid, engine: p.engine, woon_charged: r.meta.cost, balance_after: r.meta.balance, duration: dur, resolution: res };
      }
      job.prompt = p.prompt; job.label = p.label || '';
      PENDING.set(job.job_id, { engine: p.engine, prompt: p.prompt, label: p.label || '', cost: job.woon_charged, ts: Date.now() });
      return text(Object.assign({}, job, { next: 'pupa_job_status 로 2~6분 뒤 확인 (완료 시 URL 반환·작업 이력 등록)' }));
    } catch (e) { return err(e); }
  });

  server.registerTool('pupa_job_status', {
    title: '영상 작업 상태/결과', description: 'pupa_generate_video 가 돌려준 job_id 의 상태를 확인한다. 완료면 결과 URL(영구 보관본)을 돌려주고 PUPASTAGE 작업 이력에 등록한다. wait_seconds 만큼 기다렸다가 확인할 수 있다(최대 120).',
    inputSchema: { job_id: z.string(), wait_seconds: z.number().int().min(0).max(120).default(0) }
  }, async ({ job_id, wait_seconds }, extra) => {
    try {
      const A = api(extra); if (wait_seconds) await sleep(wait_seconds * 1000);
      const meta = PENDING.get(job_id) || {};
      let status = 'unknown', url = '', detail = null;
      if (job_id.startsWith('fal:')) {
        const [, app, rid] = job_id.split(':'); const st = await A.falStatus(app, rid); status = String(st.status || '').toLowerCase(); detail = { queue_position: st.queue_position };
        if (status === 'completed') { const r = await A.falResult(app, rid); url = r && r.video && r.video.url || (r && r.images && r.images[0] && r.images[0].url) || ''; }
        else if (status === 'failed' || status === 'error') detail = st;
      } else if (job_id.startsWith('piapi:')) {
        const tid = job_id.slice(6); const r = await A.piapiTask(tid); const d = r && r.data || {}; status = String(d.status || '').toLowerCase(); if (status === 'completed' || status === 'success') { status = 'completed'; url = pickPiapiUrl(r); } else if (status === 'failed') detail = d.error || d;
      } else throw new Error('알 수 없는 job_id');
      if (status === 'completed' && url) {
        let kept = url; try { const st = await A.assetStore({ url }); if (st && st.url) kept = st.url; } catch {}
        if (!meta.registered) { const kind = meta.kind || 'video'; const lab = ((kind === 'image' ? IMAGE_ENGINES : VIDEO_ENGINES)[meta.engine] || {}).label || meta.engine || ''; try { await A.jobRegister({ provider: job_id.split(':')[0], taskId: job_id.split(':').pop(), kind, engine: meta.engine || '', engineName: lab + (meta.label ? ' · ' + meta.label : ''), prompt: String(meta.prompt || '').slice(0, 2000), status: 'completed', resultUrl: kept, cost: meta.cost || 0 }); meta.registered = 1; PENDING.set(job_id, meta); } catch {} }
        return text({ status, url: kept, job_id, note: '영구 보관 + 작업 이력 등록' });
      }
      return text({ status: status || 'in_progress', job_id, detail, hint: status === 'completed' ? '결과 URL 을 찾지 못함' : '아직 진행 중 — wait_seconds=60 으로 다시 호출' });
    } catch (e) { return err(e); }
  });

  server.registerTool('pupa_save_scenario', {
    title: 'PUPASTAGE 에 시나리오 저장', description: 'PUWU 표준 MD(pupa_parse_screenplay 의 standard_md 또는 직접 쓴 MD)를 회원의 PUPASTAGE 프로젝트 목록에 «시나리오 편집본»으로 저장한다. 회원은 PUPASTAGE 대문 → 이어서 편집 → 스튜디오 적용으로 이어서 작업할 수 있다(캐릭터 북·컷 이미지·영상 생성 전부 그쪽에서).',
    inputSchema: { title: z.string().min(1).max(80), standard_md: z.string().min(30), id: z.string().optional().describe('기존 저장본을 덮어쓸 때') }
  }, async ({ title, standard_md, id }, extra) => { try { const A = api(extra); const body = { kind: 'scenario', title, data: { md: standard_md, scenes: (standard_md.match(/^##\s+S\d+/gm) || []).length, cuts: (standard_md.match(/^###\s+C\d+/gm) || []).length, savedAt: new Date().toISOString(), via: 'pupa-mcp' } }; if (id) body.id = id; const r = await A.projSave(body); return text({ ok: true, id: r.id || (r.rec && r.rec.id) || '', title, open: 'https://pupastage.com → 로그인 → 대문 «이어서 편집» 목록에서 「' + title + '」', raw: r }); } catch (e) { return err(e); } });

  server.registerTool('pupa_asset_upload', {
    title: '레퍼런스 영구 보관', description: '외부 이미지/영상 URL 또는 dataURL(base64)을 PUPASTAGE 영구 에셋 저장소에 올리고 안정된 URL 을 돌려준다. 만료되는 임시 URL 을 레퍼런스로 쓰기 전에 거친다.',
    inputSchema: { url: z.string().url().optional(), data: z.string().optional().describe('data:image/png;base64,...') }
  }, async ({ url, data }, extra) => { try { const A = api(extra); if (!url && !data) throw new Error('url 또는 data 필요'); const r = await A.assetStore({ url, data }); return text(r); } catch (e) { return err(e); } });

  server.registerTool('pupa_ledger', {
    title: '내 WOON 전표(최근)', description: '최근 크레딧 차감/충전 전표(전표번호·엔진·초수·WOON)를 돌려준다. 이번 세션에서 얼마를 썼는지 보고할 때 쓴다.',
    inputSchema: { limit: z.number().int().min(1).max(100).default(20) }
  }, async ({ limit }, extra) => { try { const A = api(extra); const r = await A.ledger(); const rows = (Array.isArray(r) ? r : (r.ledger || r.rows || [])).slice(-limit).reverse().map(e => ({ ts: e.ts ? new Date(e.ts).toISOString() : '', docno: e.docno || '', reason: e.reason, delta: e.delta, engine: e.eng || '', sec: e.dur || '', res: e.res || '' })); return text(rows); } catch (e) { return err(e); } });

  server.registerTool('pupa_jobs', {
    title: '내 최근 작업(이미지·영상)', description: 'PUPASTAGE 작업 이력(최근 100건)의 엔진·상태·결과 URL 을 돌려준다.',
    inputSchema: { limit: z.number().int().min(1).max(100).default(20), kind: z.enum(['all', 'image', 'video']).default('all') }
  }, async ({ limit, kind }, extra) => { try { const A = api(extra); const r = await A.jobsMine(); const rows = (r.jobs || []).filter(j => kind === 'all' || j.kind === kind).slice(-limit).reverse().map(j => ({ id: j.id, ts: j.ts ? new Date(j.ts).toISOString() : '', kind: j.kind, engine: j.engineName || j.engine, status: j.status, url: j.resultUrl || '', cost: j.cost || 0, docno: j.docno || '' })); return text(rows); } catch (e) { return err(e); } });

  // ── 프롬프트(워크플로) ──
  server.registerPrompt('pupa_ad_director', { title: '광고 제작 워크플로 (브랜드→콘티→영상)', description: '브랜드 정보로 광고 콘티를 짜고 PUPA 로 생성까지 가는 순서', argsSchema: { brand: z.string().describe('브랜드·제품·타깃·핵심 메시지'), seconds: z.string().default('15'), aspect: z.string().default('9:16') } },
    ({ brand, seconds, aspect }) => ({ messages: [{ role: 'user', content: { type: 'text', text: [
      '당신은 PUPA 광고 디렉터다. 아래 순서로 진행하라. 각 단계에서 크레딧이 드는 작업(이미지·영상 생성)은 비용을 먼저 말하고 사용자 확인을 받는다.',
      '1) pupa_prompt_rules(kind="ad") 를 읽는다.', '2) 브랜드 정보로 ' + seconds + '초 광고 콘티를 PUWU 표준 MD 로 쓴다(장르: 광고, 슬로건이 첫 3초 대사/자막, 마지막 컷 팩샷).', '3) pupa_parse_screenplay → pupa_plan_shots(genre="ad", total_seconds=' + seconds + ') 로 샷 플랜을 받는다.', '4) pupa_save_scenario 로 저장한다(회원이 PUPASTAGE 에서 이어서 작업 가능).', '5) 제품·모델 레퍼런스가 있으면 pupa_asset_upload 로 고정하고, 없으면 pupa_generate_image(seedream 또는 gpt_img2) 로 제품 컷/모델 시트를 1장 만든다.', '6) 컷 뼈대를 채워 하나의 ' + seconds + '초 프롬프트(Hard cut to. 로 연결, 한국어 자막은 큰따옴표 그대로)로 만들고 pupa_generate_video(seed25, ' + aspect + ', 1080p, image_urls=레퍼런스) 제출 → pupa_job_status 로 완료 확인.', '', '[브랜드]', brand].join('\n') } }] }));
  server.registerPrompt('pupa_story_cuts', { title: '이야기 씬 → 컷 구성 → 영상', description: '시나리오 씬을 컷으로 나누고 PUPA 로 생성까지', argsSchema: { screenplay: z.string().describe('시나리오 본문'), seconds: z.string().default('15') } },
    ({ screenplay, seconds }) => ({ messages: [{ role: 'user', content: { type: 'text', text: ['당신은 PUPA 연출부다. pupa_prompt_rules(kind="story") 와 kind="clip" 을 읽고, pupa_parse_screenplay → pupa_plan_shots(total_seconds=' + seconds + ') 로 샷 플랜을 받은 뒤, 컷마다 prompt_skeleton_en 을 채워(대사 원문 유지) 한 씬을 한 편의 프롬프트로 잇고, 사용자에게 비용을 확인받은 뒤 pupa_generate_video 로 제출하라. 캐릭터 얼굴 일관성이 필요하면 먼저 pupa_generate_image 로 캐릭터 시트를 만들어 image_urls 로 넘긴다.', '', '[시나리오]', screenplay].join('\n') } }] }));

  // ── 리소스 ──
  server.registerResource('pupa_rules', 'pupa://rules', { title: 'PUPA 구성 규칙 전문', mimeType: 'text/plain' }, async () => ({ contents: [{ uri: 'pupa://rules', text: rulesFor('all') }] }));
  server.registerResource('pupa_engines', 'pupa://engines', { title: 'PUPA 엔진 목록', mimeType: 'application/json' }, async () => ({ contents: [{ uri: 'pupa://engines', text: JSON.stringify({ video: VIDEO_ENGINES, image: IMAGE_ENGINES }, null, 1) }] }));
}

const PENDING = new Map();
function nearest(list, v) { let b = list[0]; for (const x of list) if (Math.abs(x - v) < Math.abs(b - v)) b = x; return b; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFal(A, app, rid, maxMs) { const t0 = Date.now(); let delay = 2000; while (Date.now() - t0 < maxMs) { const st = await A.falStatus(app, rid); const s = String(st.status || '').toLowerCase(); if (s === 'completed') return A.falResult(app, rid); if (s === 'failed' || s === 'error') throw new Error('fal 실패: ' + JSON.stringify(st).slice(0, 300)); await sleep(delay); delay = Math.min(6000, delay + 1000); } throw new Error('시간 초과 — 나중에 pupa_jobs 로 결과를 확인하세요'); }
async function waitPiapi(A, tid, maxMs) { const t0 = Date.now(); let delay = 3000; while (Date.now() - t0 < maxMs) { const r = await A.piapiTask(tid); const d = r && r.data || {}; const s = String(d.status || '').toLowerCase(); if (s === 'completed' || s === 'success') return r; if (s === 'failed') throw new Error('PiAPI 실패: ' + JSON.stringify(d.error || d).slice(0, 300)); await sleep(delay); delay = Math.min(8000, delay + 1000); } throw new Error('시간 초과 — 나중에 pupa_jobs 로 결과를 확인하세요'); }
function pickPiapiUrl(r) { const d = r && r.data || r || {}; const o = d.output || {}; return o.image_url || o.video_url || o.url || (Array.isArray(o.image_urls) && o.image_urls[0]) || (Array.isArray(o.images) && (o.images[0].url || o.images[0])) || (o.works && o.works[0] && o.works[0].video && o.works[0].video.resource_without_watermark) || (o.works && o.works[0] && o.works[0].video && o.works[0].video.resource) || (o.works && o.works[0] && o.works[0].image && o.works[0].image.resource) || ''; }
