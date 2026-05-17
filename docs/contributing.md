🇰🇷 한국어 · [🇬🇧 English](contributing.en.md)

# Contributing

작은 사이드 프로젝트라 PR은 자유롭게 환영합니다. 큰 기능 추가는 먼저 issue로 의논해주세요.

## 빠른 시작

```bash
git clone https://github.com/jkapa0417/tokenova
cd tokenova
npm install
npm run tauri dev     # 개발 모드 (popover 창이 일반 창처럼 표시됨)
```

준비물은 [README의 Build From Source](../README.md#build-from-source) 섹션 참고.

## 무엇을 PR로 받나

### 환영

- 🐛 **버그 수정** — 작거나 큰 거나 모두 OK
- 🎨 **시각 다듬기** — 별/행성/배경 / animation tuning
- 🌐 **i18n 보강** — 새 locale 추가, 기존 번역 개선
- 📦 **새 Provider 통합** — Cursor / Gemini Code / 등 ([providers.md](providers.md) 가이드)
- 📊 **추가 도감 항목** — 새 행성 종 / 별 형태 (등급 분포 변경 X)
- 🏆 **새 업적** — 엔진에 키 추가 + 트리거 로직 + i18n 텍스트
- 📝 **문서 개선**

### 먼저 의논 필요

- 🏗️ **아키텍처 변경** — 큰 모듈 재배치, DB 스키마 변경
- 💰 **모네타이제이션 / 시즌 관련** — 비즈니스 방향 영향
- 🌐 **외부 네트워크 의존 추가** — privacy 문서 약속과 충돌 가능

이런 건 PR 보내기 전에 [Issue](https://github.com/jkapa0417/tokenova/issues) 열어서 방향 합의.

## 커밋 메시지

이 repo는 1줄 제목 + 빈 줄 + 본문 형식. 예시:

```
Drop MSI from Windows bundles — ship NSIS EXE only

The Tauri auto-updater plugin only supports in-place upgrades for the
NSIS exe target on Windows; MSI users would have to manually re-install
on every release.
...
```

가이드:
- **첫 줄**: 명령형 동사 + 무엇을 했는지 (50자 이내 추천). "Fix bug" 같이 vague하지 말고 "Fix planet pins drifting away from stars during zoom/drag"처럼 구체적.
- **본문**: *왜* 그렇게 했는지. *무엇*은 diff가 이미 말해줌. context, 트레이드오프, 대안 검토 등.
- **이슈 참조**: 관련 이슈가 있으면 `Closes #123` / `Fixes #456`.
- **Co-Authored-By**: AI 도구로 작성한 부분이 있으면 trailing로 추가 (이 repo의 convention).

## PR 체크리스트

PR 보내기 전:

- [ ] `npx tsc --noEmit` → 0 error
- [ ] `cd src-tauri && cargo check` → warning 0 (또는 의도된 `#[allow]` 마킹)
- [ ] `cd src-tauri && cargo fmt --check`
- [ ] `cd src-tauri && cargo clippy --no-deps -- -D warnings`
- [ ] `cd src-tauri && cargo test --lib`
- [ ] 새 UI 문자열을 추가했으면 KO + EN 둘 다 ([i18n 가이드](i18n.md))
- [ ] 새 i18n 키를 코드에서만 쓰고 사전엔 안 박았으면 → 키 string이 그대로 보임 (test에서 발견됨)
- [ ] visual 변화면 before/after 스크린샷 또는 GIF (선택)
- [ ] 관련 docs 업데이트 (특히 [game-mechanics.md](game-mechanics.md) 수치 변경 시)

PR 본문에 위 체크리스트를 그대로 복사해서 ☑️ 표시하면 리뷰가 빠릅니다.

## 코딩 컨벤션

### Rust

- `cargo fmt` 디폴트 설정 그대로 적용 (rustfmt.toml 별도 없음)
- `cargo clippy --no-deps -- -D warnings` — warning은 PR에서 막힘
- 주요 패턴:
  - `anyhow::Result` for app errors, `?` operator로 propagate
  - `tokio` async runtime — blocking 작업은 `spawn_blocking`
  - DB는 한 군데 (`db/mod.rs`)에서만 호출, 외부 모듈은 `Arc<Db>`로 받음
  - `broadcast` channel로 이벤트 모듈 분리
- 모듈 가시성: 외부 사용 없으면 `pub` 하지 않기. dev-console에서만 쓰는 함수는 `#[cfg_attr(not(debug_assertions), allow(dead_code))]`.
- 주석: WHY 위주. WHAT은 코드 자체로 충분.

### TypeScript

- ESM (`type: "module"`). 상대 경로 import.
- `npx tsc --noEmit` strict 통과 필수.
- 코드 스타일:
  - vanilla DOM API (프레임워크 없음). `document.querySelector` / `addEventListener` 그대로.
  - 라이프사이클 함수: `activate<View>()` + `deactivate<View>()` 패턴.
  - 모든 시각 strings는 t() 통해 i18n dict.
  - 폴링 view는 `subscribeLocale`로 locale 변경에 반응.
- 주석: 마찬가지로 WHY. 특히 시각/타이밍 결정의 이유.

### CSS

- 단일 `styles.css`. 토픽별 큰 헤더 코멘트.
- CSS variables (`--gold`, `--fg-1` 등)로 색 + 폰트 통일.
- 새 컴포넌트는 BEM-ish (`.foo`, `.foo-bar`, `.foo[hidden]`).

## 이슈 / 버그 리포트

[이슈 템플릿](https://github.com/jkapa0417/tokenova/issues/new) 참고. 도움이 되는 정보:

- **환경**: OS + 버전, Tokenova 버전 (Settings → 정보 → 버전)
- **재현 단계**: 1, 2, 3, …
- **기대 vs 실제**
- **로그**: 가능하면 Tokenova 콘솔 출력. macOS는 Console.app, Windows는 이벤트 뷰어, Linux는 stderr.
- **스크린샷/GIF**: 시각 버그는 매우 도움 됨.

## 행동 강령

상호 존중. 인신공격 X. 코드/아이디어 비평은 OK, 사람 비난 X. 한국어/영어 자유롭게.

## 라이선스 동의

PR 보내는 행위는 그 코드를 이 repo의 라이선스 ([FSL-1.1-ALv2](../LICENSE.md))로 기여하는 데 동의한다는 의미입니다.

## 감사

Tokenova는 다음 오픈소스에 기대고 있습니다:
- [Tauri 2](https://v2.tauri.app/)
- [rusqlite](https://github.com/rusqlite/rusqlite)
- [notify](https://github.com/notify-rs/notify)
- [chrono](https://github.com/chronotope/chrono)
- [rand_pcg](https://crates.io/crates/rand_pcg)
- [Vite](https://vitejs.dev/)
- [Geist](https://vercel.com/font) · [JetBrains Mono](https://www.jetbrains.com/lp/mono/)

PR + 이슈 다 환영합니다. 🪐
