# Tokenova

> AI 코딩하며 쓴 토큰이 매일 새로운 우주의 별과 행성이 됩니다.
> A tray app that turns your AI coding token usage into a daily universe of stars and planets.

[![License: FSL-1.1-ALv2](https://img.shields.io/badge/License-FSL--1.1--ALv2-blue.svg)](LICENSE.md)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24c8db.svg)](https://v2.tauri.app/)

<!--
출시 직전 스크린샷 / 데모 GIF 추가:
- Today (별이 가득한 우주)
- Codex (행성 도감)
- Gallery (365 컬렉션)
- 별자리 잇기 데모 (GIF)
-->

## 핵심 컨셉

- **1,000 토큰 = 별 1개.** 코딩하면 별이 늘어남.
- **5,000 토큰 세션 = 행성 발견.** 등급은 운: Common / Rare / Epic / Legendary / Mythic.
- **매일 새 우주.** 자정에 마감 → 영구 보존. 다음날 빈 캔버스에서 다시.
- **별자리 잇기.** 마음에 드는 별들 클릭해 이으면 그날의 별자리로 저장.

일하는 방식을 바꾸라고 강요하지 않습니다. 그냥 옆에 떠 있는 트레이 앱이 매일의 코딩을 하나의 작은 우주로 기록할 뿐.

## 지원 Provider

| Provider | 위치 | 방식 |
|---|---|---|
| Claude Code | `~/.claude/projects/*.jsonl` | 파일 감시 |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` | 파일 감시 |
| OpenCode | `~/.local/share/opencode/opencode.db` | SQLite 5초 폴링 |

## 다운로드

<!-- v0.1.0 출시 시 링크 추가:
- [Windows MSI (x64)](https://github.com/.../releases/...)
- [macOS DMG (universal)](https://github.com/.../releases/...)
- [Linux AppImage](https://github.com/.../releases/...)
-->

GitHub Releases 페이지에서 OS별 인스톨러를 받으세요. (베타 기간 중 — 정식 릴리즈 준비 중)

### macOS 첫 실행 안내

DMG는 비용 문제로 Apple 코드 서명이 빠진 상태로 배포됩니다. 처음 실행할 때 macOS Gatekeeper가 차단할 수 있어요:

1. DMG를 열고 `Tokenova.app` 을 `/Applications/` 폴더로 드래그
2. 처음 실행을 시도하면 "확인되지 않은 개발자" 경고가 뜨면서 차단됨
3. **시스템 설정 → 개인정보 보호 및 보안** 으로 이동
4. 맨 아래쪽에 "Tokenova가 차단되었습니다" 항목 → **그래도 열기** 클릭
5. 한 번 더 확인 다이얼로그가 뜨면 **열기** 선택

이 절차는 처음 한 번만 필요합니다. 이후 업데이트나 재실행은 정상 동작.

> 터미널을 선호한다면: `xattr -dr com.apple.quarantine /Applications/Tokenova.app`

### Windows 첫 실행 안내

Microsoft SmartScreen이 "Windows가 PC 보호" 다이얼로그를 띄울 수 있습니다. **추가 정보 → 실행** 으로 진행하면 됩니다.

## 빌드 (개발자용)

### 사전 요구

- Rust 1.95+ · Node.js 20+
- macOS: Xcode CLT
- Windows: Microsoft Edge WebView2 (대부분 기본)
- Linux: `libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev fonts-noto-cjk`

### 빌드

```bash
git clone https://github.com/yourname/tokenova
cd tokenova
npm install
npm run tauri dev          # 개발 모드 (윈도우가 보이게 표시됨)
npm run tauri build        # 배포 번들 생성
```

### 디자인 결정 / 레퍼런스

- 빌드 플랜 + 시각 시뮬레이션 레퍼런스: [`docs/references/`](docs/references/)
- 핵심 디자인 오버라이드: [`docs/references/00-design-modifications.md`](docs/references/00-design-modifications.md)

## 라이선스

[FSL-1.1-ALv2](LICENSE.md) — **Functional Source License + Apache 2.0 Future License**.

요약:
- ✅ 개인 사용, 내부 사용, 비영리 교육·연구, 코드 수정 자유
- ✅ 2년 후 자동으로 Apache 2.0 으로 전환 (영구 무제한)
- ❌ Tokenova와 동일하거나 유사한 기능을 가진 상업 제품/서비스로 만들기 금지 (출시 후 2년 내)

상세는 [LICENSE.md](LICENSE.md) 참조.

## 기여

이 프로젝트는 개인 사이드 프로젝트로 시작되었습니다. 버그 리포트와 작은 PR 환영합니다. 큰 기능 추가는 먼저 이슈로 논의 부탁드려요.

## 후원

[GitHub Sponsors](https://github.com/sponsors/yourname) <!-- 셋업 후 링크 활성화 -->

---

> 만든 사람: junki.ahn · 만든 곳: 한국, 늦은 밤
