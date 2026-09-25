---
name: pupa-story-cuts
description: 시나리오·대본의 씬을 컷으로 나눠(앵글·사이즈·대사 표현·컷 분할) PUPA MCP 로 컷 이미지와 씬 영상을 만든다. "이 씬 영상으로", "컷 나눠줘", "콘티 만들어", "숏폼 드라마" 요청에 사용.
---

# PUPA 연출부 — 이야기 씬 → 컷 구성 → 영상

이야기는 **맥락과 흐름**이 앵글과 사이즈를 정한다. 씬의 목적을 먼저 정하고, 공간 → 관계 → 갈등 → 정점 → 여운의 흐름으로 사이즈를 움직인다.

## 순서
1. `pupa_prompt_rules(kind="story")` 와 `kind="clip"` 을 읽는다.
2. 시나리오를 `pupa_parse_screenplay` 로 구조화한다. 자유 형식(S#1 / 이름: 대사)도 된다. 결과 `standard_md` 를 사용자에게 보여 주고 씬·컷 분리가 맞는지 확인한다.
3. 씬마다 **씬의 목적** 한 문장을 쓴다 (예: "수아가 민준을 밀어내기로 결심한다").
4. `pupa_plan_shots(doc, genre="story", total_seconds=씬 길이, scene=N)` 로 샷 플랜을 받는다. 플랜의 `why` 를 보고 필요한 곳만 손본다.
   - 대사 1개 = 컷 1개. 화자 교대는 OTS 교차, 짧은 반응 대사는 상대 CU, 감정이 오르면 좁히고 정점 뒤 한 번 넓힌다.
   - 앵글은 의미로: 로우=힘, 하이=취약, 더치=불안, 뒷모습=여운.
5. 캐릭터가 있으면 `pupa_generate_image(engine="seedream"|"gpt_img2", hires=true)` 로 **캐릭터 시트**(정면 상반신, 중립 표정, 의상 명시)를 먼저 만든다 — 얼굴이 컷마다 바뀌지 않게 모든 생성에 `image_urls` 로 넘긴다.
6. 컷 이미지가 필요하면 컷마다 `pupa_generate_image(reference_urls=[캐릭터 시트])`.
7. 씬 영상: `prompt_skeleton_en` 을 채워 한 편으로 잇는다 (타임코드 · `Hard cut to.` · 이어받기 1~2개 · 한국어 대사 원문 큰따옴표 · 품질 접미 · Negative). 비용을 말하고 승인받은 뒤 `pupa_generate_video(engine="seed25", duration=총초, resolution="1080p", image_urls=[캐릭터 시트, 공간])`. 대사가 많으면 Seedance 2.5(오디오 네이티브)가 유리하고, 시작/끝 프레임 고정이 필요하면 `kling30`.
8. `pupa_job_status` 로 완료 확인 → 결과 URL·WOON 보고. 저장은 `pupa_save_scenario`.

## 금지
- 대사 원문 수정·번역·요약 금지. 나이 숫자 대신 역할·체형·의상으로.
- 승인 없는 크레딧 사용 금지.
