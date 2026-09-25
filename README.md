# pupa-mcp — PUPA(PUPASTAGE) MCP server

한국어 시나리오·광고 콘티를 **컷으로 나누고(샷 플래너)**, **Seedance 2.5 · Kling 3.0 · GPT Image 2 · Nano Banana · Seedream** 으로 이미지/영상을 만들며, 결과와 크레딧(WOON) 전표가 **PUPASTAGE 회원 계정**에 그대로 남는 MCP 서버입니다. Claude(웹·데스크톱·Code), ChatGPT(커넥터), Cursor 등 MCP 를 지원하는 어디서나 씁니다.

```
Claude / ChatGPT ──MCP──▶ pupa-mcp ──회원 토큰──▶ proxy.pupastage.com ──회사 키──▶ fal.ai / PiAPI / …
                                  │                       └─ WOON 원장(전표)·작업 이력·에셋 보관·프로젝트 저장
                                  └─ 시나리오 파서 + 샷 플래너 (LLM 없이, 0 크레딧)
```

## Higgsfield MCP 와 다른 점

| | Higgsfield MCP | **pupa-mcp** |
|---|---|---|
| 입력 | 영어 프롬프트 | **한국어 시나리오/콘티 그대로** (자유 형식·PUWU 표준 MD) — 씬·컷·대사·자료·사운드 자동 분리 |
| 구성 | LLM 이 매번 즉흥 | **샷 플래너**: 씬의 흐름(오프닝→관계→갈등→정점→여운 / 광고: 후크→문제→제품→근거→포인트→팩샷)으로 사이즈·앵글·무빙·초수를 결정, 이유까지 반환. 0 크레딧 |
| 광고 | 일반 UGC 프리셋 | **브랜드 노출 1순위·슬로건↔대사 매칭·팩샷·표시광고법** 규칙 내장 |
| 대사 | 영어 중심 | 한국어 대사·자막 **원문 보존**(Seedance 오디오 네이티브) |
| 결과 | 힉스필드 계정 안 | **PUPASTAGE 프로젝트로 저장 → 스튜디오에서 이어서 편집**(캐릭터 북·컷 이미지·타임라인) |
| 정산 | 자체 크레딧 | **WOON 전표번호**로 건별 추적, 요금표 조회 도구(`pupa_pricing`) |
| 엔진 | 힉스필드 라우팅 | fal / PiAPI 다중 경로 — Seedance 2.5 30초·1080p·이미지9+영상3+오디오3 레퍼런스, Kling 3.0 시작/끝 프레임 |

## 도구

| 도구 | 크레딧 | 설명 |
|---|---|---|
| `pupa_whoami` | 0 | 계정·WOON 잔액 |
| `pupa_pricing` | 0 | 엔진별 초수×해상도 WOON 요금표(실시간) |
| `pupa_parse_screenplay` | 0 | 시나리오 → 씬/컷/대사 JSON + PUWU 표준 MD |
| `pupa_plan_shots` | 0 | 컷마다 사이즈·앵글·무빙·렌즈·초수·이유 + 영어 프롬프트 뼈대 + 장르 규칙 |
| `pupa_prompt_rules` | 0 | 광고/이야기/클립 규칙 원문 |
| `pupa_generate_image` | ✔ | GPT Image 2(2K 옵션)·Nano Banana Pro·Seedream 5 Pro, 레퍼런스(캐릭터 북) 지원 |
| `pupa_generate_video` | ✔ | Seedance 2.5/2.0/Fast/Mini(fal), Kling 3.0(PiAPI) — job 반환 |
| `pupa_job_status` | 0 | 완료 확인 → 영구 보관 URL + 작업 이력 등록 |
| `pupa_save_scenario` | 0 | PUPASTAGE «이어서 편집» 목록에 저장 |
| `pupa_asset_upload` | 0 | 레퍼런스 영구 보관 |
| `pupa_ledger` / `pupa_jobs` | 0 | 전표 / 작업 이력 |

프롬프트(워크플로): `pupa_ad_director`, `pupa_story_cuts`. 리소스: `pupa://rules`, `pupa://engines`.

## 연결하기

PUPASTAGE 회원 계정이 필요합니다(https://pupastage.com). 회원 계정당 동시 기기 2대 — MCP 연결도 1대로 칩니다.

### Claude.ai (웹/데스크톱) — 커스텀 커넥터
설정 → 커넥터 → **커스텀 커넥터 추가** → URL `https://proxy.pupastage.com/mcp` → 연결 시 PUPASTAGE 아이디/비밀번호로 로그인(OAuth).

### ChatGPT — 개발자 모드 커넥터
설정 → 커넥터 → 개발자 모드 → **MCP 서버 추가** → URL `https://proxy.pupastage.com/mcp`, 인증 OAuth → 로그인.

### Claude Code
```bash
claude mcp add --transport http pupa https://proxy.pupastage.com/mcp
# 또는 플러그인으로 (스킬 2개 포함)
claude plugin marketplace add dircolin/pupa-mcp   # (마켓플레이스 등록 후)
```

### 내 컴퓨터에서 직접(stdio) — Claude Desktop / Cursor
```json
{ "mcpServers": { "pupa": { "command": "npx", "args": ["-y", "pupa-mcp"], "env": { "PUPA_ID": "아이디", "PUPA_PW": "비밀번호" } } } }
```
첫 실행 후 토큰은 `~/.pupa/mcp-token.json`(0600) 에 저장되고 비밀번호는 더 쓰지 않습니다.

## 서버 운영(회사)
`deploy/install-on-server.sh` — `/home/pupa/pupa-mcp` 에 설치, systemd `pupa-mcp`(포트 8790), nginx `proxy.pupastage.com/mcp` 경로 추가. 프록시 서버(`pupa-proxy`)는 수정하지 않습니다. 공급자 키는 이 서버에 없습니다.

## 개발
```bash
npm install
npm test          # 가짜 프록시로 파서·플래너·OAuth·도구 전체 스모크 (크레딧 0)
npm start         # http 모드 (PORT=8790)
npm run stdio     # stdio 모드
```

MIT © BOKcorporation
