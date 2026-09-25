// 한국어 시나리오 / PUWU 표준 MD 파서 — LLM 없이 결정적으로 씬·컷·대사·자료·사운드를 뽑는다.
// 입력이 이미 PUWU 표준 MD(## S1. / ### C1.)이면 그대로 읽고, 자유 형식(S#1, 씬 1, INT./EXT., 이름: 대사)이면 추정 규칙으로 나눈다.
// 결과는 PUWU 가 바로 읽는 표준 MD 로 다시 쓸 수 있다(toStandardMd).

const RX = {
  title: /^#\s+(?!#)(.+)$/,
  meta: /^-\s+\*\*(장르|매체|작가|연출|제작)\*\*\s*[:：]\s*(.+)$/,
  charHead: /^##\s+등장인물/,
  charLine: /^-\s+\*\*(.+?)\*\*\s*(?:\(([^)]*)\))?\s*(?:[—–-]+\s*(.*))?$/,
  sceneStd: /^##\s+S\s*(\d+)\.?\s*(.*)$/,
  cutStd: /^###\s+C\s*(\d+)\.?\s*(.*)$/,
  narr: /^-\s+\[서술\]\s*(.*)$/,
  dlg: /^-\s+\*\*\[대사\]\*\*\s*(.+)$/,
  arch: /^-\s+\*\*\[자료\]\*\*\s*(.+)$/,
  snd: /^-\s+\*\*\[사운드\]\*\*\s*(.+)$/,
  // 자유 형식 씬 헤더: S#1 / S1 / 씬 1 / Scene 1 / 1. INT. 장소 — 낮 / #1
  sceneFree: /^(?:\s*(?:S#?|씬\s*|Scene\s*|SCENE\s*|#)\s*(\d+)[.\s:)-]*(.*)$)|(?:^\s*(\d{1,3})\s*[.)]\s*((?:INT|EXT|실내|실외|내부|외부)[./\s].*)$)/i,
  sec: /\(\s*(\d+(?:\.\d+)?)\s*초\s*\)\s*$/,
  freeDlg: /^\s*([가-힣A-Za-z0-9·]{1,14})\s*(?:\(([^)]{1,20})\))?\s*[:：]\s*["“]?(.+?)["”]?\s*$/,
  freeDlgHead: /^\s*([가-힣A-Za-z0-9·]{1,14})\s*(?:\(([^)]{1,20})\))?\s*$/,
  caption: /^(자막|캡션|타이틀|슬로건|내레이션|나레이션|내레이터|NA|N\.A\.?|V\.?O\.?|CAPTION|TITLE|SUPER|NARR?)$/i
};

export function parseScreenplay(text, opts = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const isStd = lines.some(l => RX.sceneStd.test(l)) && lines.some(l => RX.cutStd.test(l) || RX.narr.test(l) || RX.dlg.test(l));
  return isStd ? parseStandard(lines) : parseFree(lines, opts);
}

function newDoc() { return { title: '', genre: '', media: '', characters: [], scenes: [], format: 'standard' }; }
function newScene(n, head) {
  const s = { n, label: 'S' + n, title: '', loc: '', time: '', type: 'NORMAL', place: '', cuts: [] };
  const h = String(head || '').trim();
  const mType = h.match(/\[([A-Z가-힣_ ]+)\]/); if (mType) s.type = mType[1].trim();
  const mPlace = h.match(/\(([^)]*)\)\s*$/); if (mPlace) s.place = mPlace[1].trim();
  s.title = h.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)\s*$/, '').trim();
  const parts = s.title.split(/[_·]/); s.loc = (parts[0] || '').trim(); s.time = (parts[1] || '').trim();
  return s;
}
function newCut(n) { return { n, content: '', dialogue: [], archive: [], sound: '', sec: 0, chars: [] }; }

function parseStandard(lines) {
  const d = newDoc(); d.format = 'standard';
  let sc = null, cut = null, inChars = false;
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (!l.trim()) continue;
    let m;
    if ((m = l.match(RX.title)) && !d.title) { d.title = m[1].trim(); continue; }
    if ((m = l.match(RX.meta))) { if (m[1] === '장르') d.genre = m[2].trim(); else if (m[1] === '매체') d.media = m[2].trim(); continue; }
    if (RX.charHead.test(l)) { inChars = true; continue; }
    if ((m = l.match(RX.sceneStd))) { inChars = false; sc = newScene(+m[1], m[2]); d.scenes.push(sc); cut = null; continue; }
    if (inChars && (m = l.match(RX.charLine))) { const meta = (m[2] || '').split(',').map(x => x.trim()); d.characters.push({ name: m[1].trim(), gender: meta[0] || '', age: meta[1] || '', desc: (m[3] || '').trim() }); continue; }
    if (!sc) continue;
    if ((m = l.match(RX.cutStd))) { cut = newCut(+m[1]); sc.cuts.push(cut); continue; }
    if (!cut) { cut = newCut(sc.cuts.length + 1); sc.cuts.push(cut); }
    if ((m = l.match(RX.narr))) { let t = m[1].trim(); const s = t.match(RX.sec); if (s) { cut.sec = +s[1]; t = t.replace(RX.sec, '').trim(); } cut.content = cut.content ? cut.content + ' ' + t : t; continue; }
    if ((m = l.match(RX.dlg))) { pushDialogue(cut, m[1]); continue; }
    if ((m = l.match(RX.arch))) { cut.archive.push(m[1].trim()); continue; }
    if ((m = l.match(RX.snd))) { cut.sound = cut.sound ? cut.sound + ' / ' + m[1].trim() : m[1].trim(); continue; }
    // 그 밖의 줄은 서술로
    const t = l.replace(/^-\s+/, '').trim(); if (t && !/^#/.test(t)) cut.content = cut.content ? cut.content + ' ' + t : t;
  }
  finish(d); return d;
}

function pushDialogue(cut, body) {
  let t = String(body || '').trim();
  const na = /\(NA\)/i.test(t); t = t.replace(/\(NA\)/ig, '').trim();
  let m = t.match(/^(.+?)\s*[:：]\s*(.+)$/);
  let who = '', line = t, dir = '';
  if (m) { who = m[1].trim(); line = m[2].trim(); }
  const md = who.match(/^(.+?)\s*\((.+)\)$/); if (md) { who = md[1].trim(); dir = md[2].trim(); }
  const md2 = line.match(/^\((.+?)\)\s*(.+)$/); if (md2) { dir = dir || md2[1].trim(); line = md2[2].trim(); }
  line = line.replace(/^["“]|["”]$/g, '').trim();
  const cap = RX.caption.test(who); if (cap) { who = who.replace(/\s*\(.*\)$/, ''); }
  cut.dialogue.push({ c: who, t: line, dir, na: na || cap });
  if (who && !cap && cut.chars.indexOf(who) < 0) cut.chars.push(who);
}

function parseFree(lines, opts) {
  const d = newDoc(); d.format = 'free';
  let sc = null, cut = null, pendingName = null, para = [];
  const flushPara = () => { if (!para.length) return; const t = para.join(' ').trim(); para = []; if (!t) return; if (!cut || cut.content || cut.dialogue.length) { cut = newCut(sc.cuts.length + 1); sc.cuts.push(cut); } const s = t.match(RX.sec); if (s) { cut.sec = +s[1]; } cut.content = t.replace(RX.sec, '').trim(); };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trimEnd();
    let m;
    if (!d.title && (m = l.match(/^#\s+(.+)$/))) { d.title = m[1].trim(); continue; }
    if (!d.title && !sc && i < 3 && l.trim() && !RX.sceneFree.test(l) && l.trim().length <= 60) { d.title = l.trim().slice(0, 60); continue; }
    if ((m = l.match(/^(?:장르|GENRE)\s*[:：]\s*(.+)$/i))) { d.genre = m[1].trim(); continue; }
    if ((m = l.match(RX.sceneFree)) && (m[1] || m[3])) {
      flushPara(); pendingName = null;
      const n = +(m[1] || m[3]); const head = (m[2] || m[4] || '').replace(/^[\s.:—–-]+/, '').trim();
      sc = newScene(n, normalizeHead(head)); d.scenes.push(sc); cut = null; continue;
    }
    if (!l.trim()) { if (pendingName) pendingName = null; flushPara(); continue; }
    if (!sc) { sc = newScene(1, ''); d.scenes.push(sc); }
    if ((m = l.match(RX.freeDlg)) && looksLikeName(m[1])) {
      flushPara();
      if (!cut || cut.dialogue.length) { cut = newCut(sc.cuts.length + 1); sc.cuts.push(cut); }
      pushDialogue(cut, m[1] + (m[2] ? ' (' + m[2] + ')' : '') + ': ' + m[3]); continue;
    }
    if ((m = l.match(RX.freeDlgHead)) && looksLikeName(m[1]) && lines[i + 1] && lines[i + 1].trim() && !RX.sceneFree.test(lines[i + 1])) {
      flushPara(); pendingName = m[1] + (m[2] ? ' (' + m[2] + ')' : ''); continue;
    }
    if (pendingName) {
      if (!cut || cut.dialogue.length) { cut = newCut(sc.cuts.length + 1); sc.cuts.push(cut); }
      pushDialogue(cut, pendingName + ': ' + l.trim()); pendingName = null; continue;
    }
    para.push(l.trim()); flushPara(); /* 자유 형식: 한 줄 = 한 컷 */
  }
  flushPara();
  // 등장인물 = 대사 화자 집합
  const seen = {}; d.scenes.forEach(s => s.cuts.forEach(c => c.chars.forEach(n => { if (!seen[n]) { seen[n] = 1; d.characters.push({ name: n, gender: '', age: '', desc: '' }); } })));
  finish(d); return d;
}
function normalizeHead(h) { return h.replace(/\s*[-—–]\s*/g, '_').replace(/\s+/g, ' ').trim(); }
function looksLikeName(s) { return s && s.length <= 14 && !/^(INT|EXT|CUT|FADE|씬|S)\b/i.test(s) && !/[.!?]$/.test(s); }
function finish(d) {
  if (d.scenes.length > 1) d.scenes = d.scenes.filter(s => s.cuts.length || s.title);
  d.scenes.forEach(s => { s.cuts.forEach((c, i) => { c.n = i + 1; }); });
  d.stats = { scenes: d.scenes.length, cuts: d.scenes.reduce((a, s) => a + s.cuts.length, 0), dialogue: d.scenes.reduce((a, s) => a + s.cuts.reduce((b, c) => b + c.dialogue.length, 0), 0), characters: d.characters.length };
}

/** 구조 → PUWU 표준 MD (스튜디오가 그대로 읽는 형식) */
export function toStandardMd(d) {
  const out = [];
  out.push('# ' + (d.title || '무제'), '');
  if (d.genre) out.push('- **장르**: ' + d.genre);
  if (d.media) out.push('- **매체**: ' + d.media);
  if (d.genre || d.media) out.push('');
  out.push('## 등장인물', '');
  (d.characters || []).forEach(c => { const meta = [c.gender, c.age].filter(Boolean).join(', '); out.push('- **' + c.name + '**' + (meta ? ' (' + meta + ')' : '') + (c.desc ? ' — ' + c.desc : '')); });
  out.push('');
  (d.scenes || []).forEach(s => {
    const head = (s.title || s.loc || '장소') + (s.time && !(s.title || '').includes(s.time) ? '_' + s.time : '');
    out.push('## S' + s.n + '. ' + head + ' [' + (s.type || 'NORMAL') + ']' + (s.place ? ' (' + s.place + ')' : ''), '');
    (s.cuts || []).forEach(c => {
      out.push('### C' + c.n + '.', '');
      const shot = c.shot ? '샷: ' + [c.shot.size, c.shot.angle, c.shot.move].filter(Boolean).join('/') + ' — ' : '';
      if (c.content || shot) out.push('- [서술] ' + shot + (c.content || '') + (c.sec ? ' (' + c.sec + '초)' : ''));
      (c.dialogue || []).forEach(dl => out.push('- **[대사]** ' + (dl.c || '') + (dl.dir ? ' (' + dl.dir + ')' : '') + ': "' + dl.t + '"' + (dl.na ? ' (NA)' : '')));
      (c.archive || []).forEach(a => out.push('- **[자료]** ' + a));
      if (c.sound) out.push('- **[사운드]** ' + c.sound);
      out.push('');
    });
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
