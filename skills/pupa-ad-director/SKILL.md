---
name: pupa-ad-director
description: 브랜드/제품 정보로 15~30초 광고 콘티를 짜고 PUPA MCP 로 컷 이미지·영상까지 생성한다. "광고 만들어줘", "CF 콘티", "릴스 광고", "제품 영상" 요청에 사용.
---

# PUPA 광고 디렉터

광고는 **브랜드 노출이 1순위**다. 이야기보다 제품이 먼저 보이고, 슬로건이 대사와 맞물리고, 마지막에 포인트(슬로건 완성형)와 로고 자리가 남아야 한다.

## 순서 (도구 이름은 PUPA MCP)
1. `pupa_prompt_rules(kind="ad")` — 규칙을 먼저 읽는다.
2. 브랜드명·제품·타깃·핵심 메시지·화면비(기본 9:16)·길이(기본 15초)를 확인한다. 없으면 한 번에 묻는다.
3. **후킹 슬로건 3안**(12자 내외, 결이 다르게: 직설/질문/감정)을 제안하고 하나를 고르게 한다.
4. 콘티를 **PUWU 표준 MD** 로 쓴다 (`# 제목`, `- **장르**: 광고`, `## 등장인물`, `## S1. 장소_시간 [NORMAL] (실내)`, `### C1.`, `- [서술] … (N초)`, `- **[대사]** 이름: "…"`, `- **[자료]** INSERT — 제품`).
   - C1 3초 안에 제품/브랜드 요소 + 슬로건(대사 또는 자막)
   - 아크: 후크 → 문제/공감 → 제품 등장 → 사용·근거(인서트) → 포인트 완성 → 팩샷(마지막 2~3초, 로고 여백)
   - 제품 컷 CU/ECU 인서트 1개 이상, 사용 장면 MS(손+제품+얼굴), 연속 동일 프레이밍 금지
   - 과장·최상급 금지(표시광고법)
5. `pupa_parse_screenplay(text=MD, genre="광고")` → `pupa_plan_shots(doc, genre="ad", total_seconds=길이)` 로 샷 플랜을 받아 초수·사이즈·앵글을 확정한다.
6. `pupa_save_scenario(title, standard_md)` 로 저장한다 — 사용자가 PUPASTAGE 에서 이어서 작업할 수 있다.
7. 레퍼런스: 제품 사진 URL 이 있으면 `pupa_asset_upload` 로 고정. 모델(인물)이 필요하면 `pupa_generate_image(engine="seedream" 또는 "gpt_img2", hires=true)` 로 **캐릭터 시트 1장** 을 먼저 만든다 (모든 컷의 얼굴 기준).
8. 영상: 컷 뼈대(`prompt_skeleton_en`)를 채워 **한 편의 영어 프롬프트**로 잇는다. 구간마다 `[0s-3s]` 타임코드, 사이 `Hard cut to.`, 한국어 자막/대사는 큰따옴표 원문 그대로, 제품 구간마다 `product clearly visible, label facing camera`, 마지막 구간 `leave clean negative space for logo`, 끝에 품질 접미 + `Negative:` 한 줄.
   - 비용을 `pupa_pricing` 으로 확인해 **사용자에게 말하고 승인받은 뒤** `pupa_generate_video(engine="seed25", duration, resolution="1080p", aspect_ratio, image_urls=[제품, 모델 시트], generate_audio=true)`.
9. `pupa_job_status(job_id, wait_seconds=60)` 를 완료까지 반복(보통 2~6분). 결과 URL 과 차감 WOON 을 보고한다.

## 금지
- 로고를 그리라고 프롬프트에 쓰지 않는다(후반 합성). 여백만 남긴다.
- 사용자 승인 없이 크레딧이 드는 도구를 부르지 않는다.
- 슬로건·대사를 영어로 번역하지 않는다.
