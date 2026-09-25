// 씬 단위 샷 플래너 — PUWU 본체 v3.2.567 의 규칙과 같은 결정 논리 (서버 판).
// 컷 하나가 아니라 «씬 안의 자리»(오프닝·대화 차례·감정 상승·정점·여운)로 사이즈·앵글·무빙·렌즈·초수를 정한다.
// LLM 을 부르지 않는다 → 0 크레딧, 결정적, 즉시.

export const SIZES = ['EWS', 'WS', 'FS', 'MFS', 'MS', 'MCU', 'CU', 'BCU', 'ECU'];
export const SIZE_EN = { EWS: 'extreme wide shot', WS: 'wide shot', FS: 'full shot', MFS: 'medium full shot (knee shot)', MS: 'medium shot', MCU: 'medium close-up', CU: 'close-up', BCU: 'big close-up', ECU: 'extreme close-up' };
export const ANGLE_EN = { 'Eye Level': 'eye-level angle', 'Low Angle': 'low angle', 'High Angle': 'high angle', 'Dutch Angle': 'dutch angle', 'Back View': 'back view', 'OTS': 'over-the-shoulder', "Bird's Eye": "bird's-eye view", 'Overhead': 'overhead' };

function step(sz, d) { let i = SIZES.indexOf(sz); if (i < 0) i = 4; i = Math.max(0, Math.min(SIZES.length - 1, i + d)); return SIZES[i]; }
export function intensity(t) {
  let hi = 0, lo = 0; t = String(t || '');
  [/눈물|울음|울며|흐느|오열|절규|비명|소리치|고함/, /고백|충격|경악|얼어붙|떨리|떨며|숨을|숨이|심장/, /분노|화를|노려|이를 악|주먹|밀치|때리|폭발|무너/, /키스|껴안|포옹|손을 잡|입맞/, /죽|피가|칼|총|위험|공포|소름|공황|무서|두려|겁이/, /결심|다짐|마지막|이별|떠나|떠날|돌아서/].forEach(r => { if (r.test(t)) hi++; });
  [/미소|웃으|웃음|평온|느긋|산책|일상|한가|여유/, /설명|소개|안내|둘러보|풍경|전경/].forEach(r => { if (r.test(t)) lo++; });
  return hi - lo;
}
export function baseFromKeywords(text) {
  const t = String(text || '').toLowerCase();
  const n = { size: 'MS', angle: 'Eye Level', lens: '35mm', move: 'Static', tone: '' };
  if (/얼굴|눈물|눈빛|표정|입술|미소|속삭|눈을\s*감|눈을\s*뜨|클로즈업|close.?up/i.test(t)) { n.size = 'CU'; n.lens = '85mm'; }
  else if (/디테일|손가락|반지|시계|열쇠|문자|화면|텍스트|글자/i.test(t)) { n.size = 'ECU'; n.lens = '100mm'; }
  else if (/전경|전체|걸어|뛰어|달리|풍경|건물|거리|외관|파노라마|wide|풀샷/i.test(t)) { n.size = 'WS'; n.lens = '24mm'; }
  else if (/대화|이야기|말하|웃으며|고개를|바라보|인터뷰/i.test(t)) { n.size = 'MCU'; n.lens = '50mm'; }
  if (/올려다|위엄|거대|건물.*위|하늘|low.?angle/i.test(t)) n.angle = 'Low Angle';
  else if (/내려다|조감|위에서|옥상|high.?angle|버드/i.test(t)) n.angle = 'High Angle';
  else if (/어깨너머|뒤에서|ots|over.?the.?shoulder/i.test(t)) n.angle = 'OTS';
  if (/따라가|추적|쫓|tracking|follow/i.test(t)) n.move = 'Tracking';
  else if (/천천히|서서히|이동|pan|슬라이드/i.test(t)) n.move = 'Pan';
  else if (/올라|내려|tilt|기울/i.test(t)) n.move = 'Tilt';
  else if (/다가|접근|zoom|확대/i.test(t)) n.move = 'Dolly In';
  else if (/멀어|후퇴|벌어/i.test(t)) n.move = 'Dolly Out';
  else if (/흔들|핸드헬드|긴장|공포/i.test(t)) n.move = 'Handheld';
  else if (/돌|회전|orbit|서클/i.test(t)) n.move = 'Orbit';
  if (/따뜻|온기|포근|따스|golden|골든/i.test(t)) n.tone = 'warm'; else if (/차가운|서늘|냉|cool|블루/i.test(t)) n.tone = 'cool'; else if (/어두운|그림자|암울|dark|noir/i.test(t)) n.tone = 'dark/moody';
  return n;
}

/** scene = {cuts:[{content,dialogue:[{c,t}],archive:[],sec}]} ; genre 'ad'|'story' */
export function planScene(scene, genre = 'story', opts = {}) {
  const cuts = scene.cuts || [], n = cuts.length, ad = genre === 'ad';
  const speakers = {}; cuts.forEach(c => (c.dialogue || []).forEach(d => { if (d && d.c) speakers[d.c] = 1; }));
  const nChars = Object.keys(speakers).length;
  const out = [];
  for (let idx = 0; idx < n; idx++) {
    const cut = cuts[idx];
    const txt = String(cut.content || '') + ' ' + (cut.dialogue || []).map(d => d.t || '').join(' ') + ' ' + (cut.archive || []).join(' ');
    const base = baseFromKeywords(txt); const o = Object.assign({}, base); const why = [];
    const dlg = (cut.dialogue || []).filter(d => d && d.t);
    const spk = dlg.length ? String(dlg[0].c || '') : '';
    const prev = idx > 0 ? out[idx - 1] : null, prevCut = idx > 0 ? cuts[idx - 1] : null;
    const prevDlg = prevCut ? (prevCut.dialogue || []).filter(d => d && d.t) : [];
    const prevSpk = prevDlg.length ? String(prevDlg[0].c || '') : '';
    const inten = intensity(txt);
    const explicitCU = /얼굴|눈물|눈빛|표정|입술|클로즈업|close.?up|디테일|손가락|반지|시계/i.test(txt);
    const product = /제품|패키지|병|캔|박스|용기|로고|브랜드|INSERT|인서트|라벨|팩샷|pack ?shot/i.test(txt) || (cut.archive || []).length > 0;
    if (idx === 0 && !explicitCU) { if (ad) { o.size = product ? 'CU' : 'MCU'; o.lens = product ? '85mm' : '50mm'; why.push(product ? '후크·제품 히어로' : '후크·얼굴'); } else { o.size = n >= 3 ? 'WS' : 'FS'; o.lens = '24mm'; why.push('씬 오프닝·공간 세우기'); } }
    else if (dlg.length) {
      const t0 = String(dlg[0].t || '').trim(); const short = t0.replace(/[\s"'“”…?!.,]/g, '').length <= 6;
      if (short && prevDlg.length) { o.size = 'CU'; o.lens = '85mm'; why.push('짧은 반응 대사 → 리액션 CU'); }
      else if (inten >= 2) { o.size = 'CU'; o.lens = '85mm'; why.push('감정 대사 → CU'); }
      else if (nChars >= 2 && prevSpk && spk && prevSpk !== spk) { o.size = 'MCU'; o.angle = 'OTS'; o.lens = '50mm'; why.push('화자 교대 → OTS 교차'); }
      else if (nChars >= 2 && !prevDlg.length && !(prev && /^(EWS|WS|FS|MFS|MS)$/.test(prev.size))) { o.size = 'MS'; o.lens = '35mm'; why.push('대화 시작 → 투샷/관계'); }
      else { o.size = 'MCU'; o.lens = '50mm'; why.push('대사 기본 MCU'); }
    }
    else if (product && ad) { o.size = /사용|쥐|들고|바르|마시|먹/.test(txt) ? 'MS' : 'ECU'; o.lens = o.size === 'MS' ? '35mm' : '100mm'; why.push(o.size === 'MS' ? '제품 사용 장면(손+제품+얼굴)' : '제품 인서트'); }
    else if (inten >= 2) { o.size = step(prev ? prev.size : 'MS', +1); if (SIZES.indexOf(o.size) < 5) o.size = 'MCU'; o.lens = '85mm'; why.push('감정 상승 → 사이즈 좁힘'); }
    else if (idx === n - 1 && n >= 3 && !explicitCU && !ad) { o.size = inten >= 1 ? 'CU' : 'WS'; o.lens = inten >= 1 ? '85mm' : '24mm'; why.push(inten >= 1 ? '정점 마무리 CU' : '여운·넓게'); }
    if (!/OTS/.test(o.angle)) {
      if (/위협|압도|명령|군림|거대|권력|올려다|우뚝/.test(txt)) { o.angle = 'Low Angle'; why.push('힘·위협 → 로우'); }
      else if (/취약|무력|외로|작아|굴복|주저앉|무릎|웅크|쓰러/.test(txt)) { o.angle = 'High Angle'; why.push('취약·고립 → 하이'); }
      else if (/혼란|어지러|불안|취한|비틀|공황|악몽/.test(txt)) { o.angle = 'Dutch Angle'; why.push('불안·혼란 → 더치'); }
      else if (/뒷모습|돌아서|멀어져 가|떠나가/.test(txt) && !dlg.length) { o.angle = 'Back View'; why.push('여운 → 뒷모습'); }
    }
    if (ad && idx === n - 1 && n >= 2) { o.size = 'MS'; o.angle = 'Eye Level'; o.move = 'Static'; o.lens = '50mm'; o.packShot = true; why.push('클로징 팩샷(로고 여백)'); }
    if (prev && prev.size === o.size && (prev.angle || 'Eye Level') === (o.angle || 'Eye Level')) { const pp = idx > 1 ? out[idx - 2] : null; let dir = inten >= 1 ? +1 : -1; if (pp && pp.size === o.size) dir = SIZES.indexOf(o.size) >= 5 ? -2 : +2; o.size = step(o.size, dir); why.push('연속 동일 프레이밍 회피'); }
    if (!why.length) why.push('본문 키워드 추론');
    // 초수 — 대사 음절/템포 + 기본
    let sec = +cut.sec || 0;
    if (!sec) {
      if (dlg.length) { const syl = dlg.reduce((a, d) => a + String(d.t || '').replace(/[^가-힣A-Za-z0-9]/g, '').length, 0); const tempo = inten >= 2 ? 4.5 : 5.5; sec = Math.max(2, Math.round((syl / tempo + 0.6) * 2) / 2); }
      else sec = o.size === 'ECU' || o.size === 'CU' ? 2 : idx === 0 ? 3 : 2.5;
      if (o.packShot) sec = Math.max(sec, 2.5);
    }
    o.sec = sec; o.why = why.join(' · ');
    o.sizeEn = SIZE_EN[o.size] || o.size; o.angleEn = ANGLE_EN[o.angle] || String(o.angle).toLowerCase();
    o.intensity = inten;
    out.push(o);
  }
  // 총 길이 맞추기(선택)
  if (opts.totalSeconds > 0 && out.length) {
    const sum = out.reduce((a, o) => a + o.sec, 0); const k = opts.totalSeconds / sum;
    let acc = 0; out.forEach((o, i) => { o.sec = Math.max(1.5, Math.round(o.sec * k * 2) / 2); acc += o.sec; });
    out[out.length - 1].sec = Math.max(1.5, Math.round((out[out.length - 1].sec + (opts.totalSeconds - acc)) * 2) / 2);
  }
  let t = 0; out.forEach(o => { o.t0 = t; t = Math.round((t + o.sec) * 10) / 10; o.t1 = t; });
  return out;
}

export function detectGenre(doc) {
  const g = String((doc && (doc.genre || '')) || '') + ' ' + String((doc && doc.media) || '');
  return /광고|CF|커머셜|브랜디드|홍보|commercial|\bad\b/i.test(g) ? 'ad' : 'story';
}

export const RULES = {
  ad_ko: [
    '[브랜드 노출 1순위] 브랜드/제품은 첫 컷(3초) 안에 반드시 화면에 보인다(제품·패키지·로고 자리·브랜드 컬러 중 하나). 전체 컷의 40% 이상에서 제품 또는 브랜드 요소가 프레임 안에 있어야 한다.',
    '[슬로건↔대사 매칭] 후크 슬로건의 핵심 어휘가 대사에 1회 이상 그대로 되풀이된다. 마지막 컷의 대사/자막은 슬로건의 완성형(앞에서 던진 문제·질문의 답)이어야 한다.',
    '[광고 아크] 후크(문제·욕망·시선) → 공감/문제 확대 → 제품 등장(해결) → 사용 장면·근거(디테일 인서트) → 포인트 완성(슬로건 완성 대사) → 브랜드 클로징(제품 팩샷 + 로고 자리 2~3초). 컷이 적으면 단계를 합치되 순서는 지킨다.',
    '[샷 구성] 제품 등장 컷은 CU/ECU 인서트 1개 이상, 사용 장면은 MS(손+제품+얼굴), 후크와 포인트 대사는 얼굴이 읽히는 MCU. 연속 두 컷에 같은 샷 사이즈·앵글 금지. 감정이 오르면 사이즈를 좁힌다.',
    '[제품 규칙] 제품을 쥔 손은 한 손만, 손가락 5개, 라벨은 카메라를 향한다. 로고는 후반 합성이 원칙 — 생성 프롬프트에 로고를 그리라고 쓰지 말고 «clean negative space for logo» 로 여백을 남긴다.',
    '[법] 과장·최상급 표현(최고·1위·유일·완치·부작용 없음) 금지 — 표시광고법.'
  ],
  story_ko: [
    '[씬의 목적] 이 씬이 이야기에서 해내야 할 일을 한 문장으로 먼저 정하고, 그 목적에 봉사하지 않는 컷은 넣지 않는다.',
    '[흐름] 공간 세우기(와이드) → 인물·관계(투샷/미디엄) → 갈등의 핵심(대사 컷: MCU/OTS 교차) → 감정의 정점(CU/ECU, 침묵 허용) → 여운(와이드 또는 뒷모습). 감정이 오르면 사이즈를 좁히고, 정점 직후 한 번 넓힌다.',
    '[앵글의 의미] 로우=힘·위협·결심 / 하이=취약·고립·패배 / 더치=불안·혼란 / 아이레벨=공감·중립 / 뒷모습=여운·고독 / OTS=대화의 긴장.',
    '[대사 표현] 괄호 지시(떨며, 차갑게…)는 보이는 연기로 옮긴다(시선 회피, 손 떨림, 호흡). 중요한 대사일수록 얼굴이 크게 읽히는 사이즈. 짧은 반응 대사(«…뭐?», «네?»)는 듣는 사람의 CU 리액션 컷으로. 대사 원문은 한 글자도 바꾸지 않는다.',
    '[컷 분할] 대사 1개 = 컷 1개가 기본. 인물이 2명 이상이면 첫 컷은 대사 없는 마스터 컷으로 공간을 먼저 세운다. 같은 인물 싱글 3연속 금지(4번째는 투샷·와이드·인서트로 리셋). O.S. 컷 2연속 금지. 인서트(소품·손)는 대사의 전환점 직전에 넣어 다음 감정을 예고한다.',
    '[대사 길이] 대사 컷 초수 = (한글 음절수 ÷ 템포) + 0.4초 이상. 템포(음절/초): 격앙 6.5 / 평상 5.5 / 침착 4.5 / 주저·오열 3.5.'
  ],
  clip_en: [
    'CUT DISCIPLINE: give every beat a timecode like [0s-3s]; separate beats with the exact phrase "Hard cut to."; never morph, dissolve or warp between beats; faces, bodies and props stay structurally stable.',
    'ONE ACTION PER CUT: each cut has one main action; state size · angle · camera move in every cut header (e.g. "Medium close-up, eye level, static").',
    'CONTINUITY HANDOFF: when the cut changes, restate 1–2 physical facts from the end of the previous cut (position, prop in hand, gaze direction). Keep the 180° line and eyelines (A looks screen-right, B looks screen-left).',
    'PERFORMANCE: translate parenthetical directions into visible acting (micro-expressions, breathing, hands, posture). Korean on-screen captions/dialogue stay in Korean inside double quotes — never translate them.',
    'HANDS & PROPS: at most one hand touches a prop; five fingers; product label faces the camera.',
    'QUALITY SUFFIX: end the visual description with "photorealistic, natural skin texture, consistent lighting and color, no morphing, no warping, stable face and body." Then one Negative: line (distorted face, extra fingers, watermark, text artifacts, logo).'
  ],
  ad_en: 'AD RULE: the brand or product must be clearly visible in the first 3 seconds and in the final frame; the final 2–3 seconds are a pack shot with minimal motion and clean negative space for a logo.',
  story_en: 'STORY RULE: frame size follows emotion (tighten as intensity rises, widen once after the peak); the camera angle carries meaning (low = power/threat, high = vulnerability, dutch = unease, back view = lingering).'
};

export function rulesFor(kind) {
  if (kind === 'ad') return RULES.ad_ko.join('\n');
  if (kind === 'story') return RULES.story_ko.join('\n');
  if (kind === 'clip') return RULES.clip_en.join('\n');
  return [RULES.ad_ko.join('\n'), '', RULES.story_ko.join('\n'), '', RULES.clip_en.join('\n')].join('\n');
}

/** 컷 하나의 영어 프롬프트 뼈대 — LLM 이 채워 넣을 «형식» (PUWU 컷구성 설계 형식과 동일) */
export function cutPromptSkeleton(scene, cut, plan, genre) {
  const lines = [];
  lines.push('[' + plan.t0 + 's-' + plan.t1 + 's] ' + cap(plan.sizeEn) + ', ' + plan.angleEn + ', ' + String(plan.move || 'static').toLowerCase() + (plan.lens ? ', ' + plan.lens : '') + '.');
  if (scene && (scene.loc || scene.time)) lines.push('Setting: ' + [scene.loc, scene.time, scene.place].filter(Boolean).join(', ') + '.');
  if (cut.content) lines.push('Action: ' + cut.content);
  (cut.dialogue || []).forEach(d => lines.push((d.na ? 'Voice-over' : (d.c || 'Character')) + (d.dir ? ' (' + d.dir + ')' : '') + ' says in Korean: "' + d.t + '"'));
  (cut.archive || []).forEach(a => lines.push('Insert: ' + a));
  if (cut.sound) lines.push('Sound: ' + cut.sound);
  if (plan.packShot) lines.push('Pack shot: product centered, minimal motion, clean negative space for logo.');
  lines.push('Hard cut to.');
  return lines.join('\n');
}
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
