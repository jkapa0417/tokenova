<div align="center">

🇰🇷 한국어 · [🇬🇧 English](README.en.md)

<img src="src-tauri/icons/icon.png" alt="Tokenova" width="180" />

# Tokenova

**AI 코딩하며 쓴 토큰이 매일 새로운 우주의 별과 행성이 됩니다.**
A tray app that turns your AI coding token usage into a daily universe of stars and planets.

[![Release](https://img.shields.io/github/v/release/jkapa0417/tokenova?include_prereleases&color=d4a857)](https://github.com/jkapa0417/tokenova/releases)
[![License](https://img.shields.io/badge/license-FSL--1.1--ALv2-d4a857.svg)](LICENSE.md)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24c8db.svg)](https://v2.tauri.app/)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-555.svg)](#download)
[![Korean | English](https://img.shields.io/badge/i18n-한국어%20%7C%20English-555.svg)](#interface-language)

</div>

---

## 무엇인가요

매일 켜져있는 작은 트레이/메뉴바 앱이 백그라운드에서 **Claude Code · Codex CLI · OpenCode**가 남기는 토큰 로그를 읽어, 그날의 작업을 **하나의 우주**로 시각화합니다.

- 코딩을 시작하면 별이 떠오릅니다.
- 무거운 세션 한 번이 행성을 발견합니다.
- 자정에 우주가 닫히고 영구 보존됩니다.
- 다음 날, 빈 캔버스 하나가 다시 열립니다.

일하는 방식을 바꾸라고 강요하지 않습니다. 곁에 떠 있는 작은 우주가 매일의 코딩을 조용히 기록할 뿐입니다.

> *Tokenova doesn't ask you to change how you work. It just keeps a small universe at the edge of your screen, quietly recording your day in code.*

---

## 핵심 메커니즘

| 이벤트 | 조건 | 결과 |
|---|---|---|
| ⭐ **별** | 200,000 토큰마다 1개 | 그 날의 별 카운트 증가 |
| 🪐 **행성 발견** | 세션이 5분 idle로 닫히며 **≥1M 토큰**, 또는 활성 세션이 **20M 토큰 누적**할 때마다 | 확률 기반 등급 (Common 70% / Rare 20% / Epic 8% / Legendary 1.9% / Mythic 0.1%) |
| 🌌 **은하 등급** | 별 누적 수 | Black Hole (0) · Nebula (1–30) · Cluster (31–100) · Galaxy (101–300) · Mega Galaxy (301–999) · Supercluster (1000+) |
| ✨ **별자리** | 2개 이상의 별을 직접 선택해 잇기 | 코덱스에 영구 등록, 이름 변경 가능 |
| 💤 **잠든 우주** | 토큰을 거의 쓰지 않은 하루 | 별 대신 부드러운 잔잔한 풍경 + 업적 |

세션은 **5분 idle**로 자동 종료. 활성 세션이 1회에 1M 토큰을 넘으면 닫힐 때 행성을 발견하고, 그 안에서 추가로 매 20M 토큰마다 강제 트리거가 한 번씩 발사됩니다. 일일 캡은 행성 10개 (Mythic 제외).

---

## 주요 기능

- **🪐 30종 행성 코덱스** — Common 12 / Rare 10 / Epic 5 / Legendary 2 / Mythic 1 (Black Hole). 발견 횟수와 첫/마지막 발견일이 기록됩니다.
- **⭐ 별 도감 14종** — Round · Diamond · Pentagon · Hexagram · Heptagon · Octagram · Starburst · Binary · Ringed · Pulsar · Comet · Inner Galaxy · Cross · Spiral.
- **🏆 18가지 업적** — 첫 별, 도감 25%/50%/완성, 첫 희귀/전설/신화, 7일/30일/100일/365일 연속, 잠든 우주의 날, 거대 은하, 등.
- **📅 365일 갤러리** — 주간 / 월간 / 1년 히트맵. 과거 우주는 라이브 캔버스로 재현 (zoom + drag).
- **🎨 별자리 등록** — Today에서 별 클릭으로 잇고 한글/영문 이름 부여. 마이미니 캔버스로 코덱스에 보관, 자기 은하 위에 오버레이 토글 가능.
- **🔭 행성 발견 오버레이** — Mythic 발견 시 가득 차는 강조 화면, 회전하는 행성 SVG, 등급 라벨, NEW 배지.
- **🔔 트레이 알림** — Mythic / Legendary / Epic / Rare 등급 발견, 100 별 달성(은하 형성), 업적, 자정 마감.
- **🌐 KO / EN 인터페이스** — 설정에서 즉시 전환. 30종 행성명, 14종 별 형태, 모든 UI 문자열 양쪽 로컬라이즈.
- **🔄 자동 업데이트** — minisign 서명 + GitHub Releases 기반 매니페스트. 새 버전 감지 시 인앱 배너.
- **🪟 OS 친화 트레이 아이콘** — macOS 모노 silhouette template (라이트/다크 자동), Windows·Linux 풀컬러 행성+골드링. 행성 발견 대기 시 골드 도트 표시.

---

## 인터페이스 미리보기

> 스크린샷은 v0.1.0 정식 출시 시 추가 예정. 디자인 시뮬레이션은 [`docs/references/`](docs/references/).

브랜드 마크 (탭/트레이/Dock 공통):

| | macOS 메뉴바 | Windows / Linux 트레이 | Discovery 알림 |
|---|:---:|:---:|:---:|
| | <img src="src-tauri/icons/tray-mac.png" width="44" alt="macOS template" /> | <img src="src-tauri/icons/tray-win.png" width="44" alt="Windows tray" /> | <img src="src-tauri/icons/tray-win-discovery.png" width="44" alt="Discovery indicator" /> |
| 동작 | 시스템 자동 tint | 컬러 그대로 | 골드 dot 부착 |

---

## 지원 Provider

| Provider | 기본 경로 | 방식 |
|---|---|---|
| **Claude Code** | `~/.claude/projects/` | JSONL 파일 시스템 감시 |
| **Codex CLI** | `~/.codex/sessions/YYYY/MM/DD/` | JSONL 파일 시스템 감시 |
| **OpenCode** | `~/.local/share/opencode/opencode.db` (Linux · macOS) / `%APPDATA%\opencode\opencode.db` (Windows) | SQLite 5초 폴링 |

기본 경로가 다른 경우 **Settings → LLM Providers**에서 직접 등록 가능. OpenCode는 환경변수 `OPENCODE_DATA_DIR` 도 인식합니다.

---

## Download

GitHub Releases 페이지에서 OS별 인스톨러를 받으세요.

👉 **[Latest release](https://github.com/jkapa0417/tokenova/releases/latest)**

| OS | 파일 |
|---|---|
| **macOS** (Intel + Apple Silicon) | `Tokenova_<version>_universal.dmg` |
| **Windows** (x64) | `Tokenova_<version>_x64-setup.exe` |
| **Linux** (x64) | `tokenova_<version>_amd64.AppImage` · `tokenova_<version>_amd64.deb` |

> 한 번 설치한 후에는 인앱 자동 업데이트가 새 버전을 감지하면 알려줍니다.

### macOS 첫 실행

DMG는 코드 서명이 빠진 상태로 배포되므로 Gatekeeper가 차단합니다 — 한 번만 우회하면 됩니다.

1. DMG를 열고 `Tokenova.app`을 `/Applications/` 폴더로 드래그
2. **우클릭 → 열기** (또는 `xattr -dr com.apple.quarantine /Applications/Tokenova.app`)
3. "확인되지 않은 개발자" 다이얼로그에서 **열기** 선택

이후 메뉴바 우상단에 작은 행성 아이콘이 나타납니다. 좌클릭으로 popover, 우클릭으로 메뉴.

### Windows 첫 실행

SmartScreen이 "Windows가 PC를 보호" 다이얼로그를 띄울 수 있습니다 → **추가 정보 → 실행** 으로 진행.

### Linux (GNOME 사용자 주의)

GNOME은 기본적으로 system tray를 숨깁니다. AppIndicator 익스텐션을 깔면 트레이 아이콘이 나타납니다:

```bash
sudo apt install gnome-shell-extension-appindicator
gnome-extensions enable ubuntu-appindicators@ubuntu.com
```

KDE Plasma · XFCE · Cinnamon · MATE는 별도 설정 없이 동작.

---

## 작동 방식 (간단히)

```
┌──────────────┐    파일감시 / 폴링    ┌─────────────┐
│  Provider 로그  │ ────────────────→ │   Watcher   │
│  (JSONL / DB)  │                   │   (Rust)    │
└──────────────┘                   └──────┬──────┘
                                          │ TokenEvent
                                          ↓
                                  ┌──────────────┐
                                  │   SQLite     │
                                  │  (1개 DB)     │
                                  └──────┬───────┘
                                         │
                          ┌──────────────┼──────────────┐
                          ↓              ↓              ↓
                  ┌──────────────┐ ┌──────────┐ ┌────────────┐
                  │   Engine     │ │ Session  │ │ Notifier   │
                  │  (별/행성/업적) │ │  Mgr     │ │ (OS 알림)   │
                  └──────┬───────┘ └─────┬────┘ └────────────┘
                         │ Tauri event   │
                         ↓               ↓
                  ┌─────────────────────────────────┐
                  │  Frontend (Vanilla TS + Canvas)  │
                  │   Today · Codex · Gallery · 설정   │
                  └─────────────────────────────────┘
```

- **Provider 로그는 절대 외부로 나가지 않습니다.** 모든 처리가 로컬 — 토큰 데이터는 OS의 사용자 디렉터리에 SQLite로 저장.
- **시드 결정론적 우주 생성.** 같은 날짜는 같은 universe seed → 같은 layout/palette/cluster name.
- **자정 롤오버는 3중 안전.** 전용 타이머 + 토큰 이벤트 늦은 도착 시 lazy refresh + 페이로드 폴링 시 lazy refresh. 노트북이 자정에 sleep 중이어도 깨어나는 즉시 정확히 새 우주가 열립니다.

---

## Build From Source

### 사전 요구

- **Rust 1.95+** (`rustup install stable`)
- **Node.js 20+**
- **macOS**: Xcode CLT (`xcode-select --install`)
- **Windows**: Microsoft Edge WebView2 (대부분 사전 설치됨), Visual Studio C++ Build Tools
- **Linux**:
  ```bash
  sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev \
                   libayatana-appindicator3-dev librsvg2-dev \
                   libssl-dev fonts-noto-cjk libnotify-bin
  ```

### 개발 모드

```bash
git clone https://github.com/jkapa0417/tokenova
cd tokenova
npm install
npm run tauri dev
```

debug 빌드는 popover 창이 데코레이션 + 항상 표시 상태로 떠서 트레이 없이도 개발 가능. 또한 **debug 빌드 한정**으로 E2E 테스트용 HTTP 콘솔(`dev-console/`)이 사용 가능 — release 번들에는 포함되지 않습니다.

### 배포 빌드

```bash
npm run tauri build
```

플랫폼별 산출물은 `src-tauri/target/release/bundle/`에 생성됩니다.

### 자동 업데이트 활성화 (포크 시)

새 minisign 키페어 생성 후 `src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`에 공개키를, GitHub Actions Secret `TAURI_SIGNING_PRIVATE_KEY`에 비공개키를 등록.

```bash
npx tauri signer generate -w ~/.tauri/your-key.key -p ""
cat ~/.tauri/your-key.key.pub   # → tauri.conf.json
cat ~/.tauri/your-key.key       # → GitHub Repo Secrets
```

태그 `v*` (또는 prerelease용 `v*-rc.N`) 푸시하면 `.github/workflows/release.yml`이 3개 OS에서 빌드 + 서명 + 자동 publish.

---

## 인터페이스 언어 / Interface Language

Tokenova는 한국어와 영어를 모두 지원합니다. **Settings → 언어**에서 즉시 전환되며, 다음 항목까지 모두 반영됩니다:

- UI 라벨 · 헤더 · HUD · 툴팁
- 30종 행성 이름 + 설명
- 14종 별 형태 이름 + 설명
- 18가지 업적 이름 + 설명
- 6단계 은하 등급
- OS 트레이 알림 (백엔드도 locale-aware)

자동 감지 우선순위는 *저장된 설정 → 시스템 locale → 한국어*. 별자리 이름과 은하 이름은 사용자가 직접 자유롭게 입력 가능 (KO·EN·기타 언어 모두 OK).

---

## 디자인 결정 · 참고

- 빌드 플랜 + 시각 시뮬레이션 레퍼런스: [`docs/references/`](docs/references/)
- 핵심 디자인 오버라이드: [`docs/references/00-design-modifications.md`](docs/references/00-design-modifications.md)
- 색상 팔레트: 깊은 우주 navy + Tokenova gold (`#d4a857`)
- 폰트: **Geist** (sans, UI), **JetBrains Mono** (mono, 숫자/HUD)

---

## 로드맵

- [x] **v0.1.0** · 첫 정식 릴리스 — Mac DMG · Windows EXE · Linux AppImage/deb · 자동 업데이트 · KO/EN
- [ ] **v0.2.0** · 사이드 아이디어
  - 주간 다이제스트 (요약 PNG export · 공유)
  - Provider 추가 (Cursor · Gemini Code · etc.)
  - 시간대별 작업 리듬 업적 (Night Owl · Early Bird)
- [ ] **v1.0.0** · macOS Developer ID + Windows EV 코드 서명, Sponsor 활성화
- [ ] **v1.x+** · 장기 비전 ([docs/vision.md](docs/vision.md) 참고)
  - 🌐 **커뮤니티 (opt-in)**: 본인 별자리/은하 공유 갤러리, 익명 통계 비교, 개발자 커피챗
  - 🍂 **시즌 코스메틱**: 봄/할로윈/겨울/사이버펑크 시각 테마 — 현재 빌드의 코어 기능에는 영향 없음

장기 방향과 현재 시점의 원칙은 [vision 문서](docs/vision.md)에 정리해뒀습니다.

---

## 라이선스

**[FSL-1.1-ALv2](LICENSE.md)** — Functional Source License with Apache 2.0 Future License.

| 허용 | 제한 |
|---|---|
| ✅ 개인 사용 · 내부 사용 · 비영리 교육 · 연구 | ❌ Tokenova와 동일/유사 상업 제품 출시 (2년) |
| ✅ 코드 수정 · 포크 · 학습 자료 | |
| ✅ **2년 후 자동으로 Apache 2.0 전환** (영구) | |

상세는 [LICENSE.md](LICENSE.md) 참조.

---

## 기여

개인 사이드 프로젝트로 시작했지만 버그 리포트와 작은 PR을 환영합니다.

- 버그·제안: [Issues](https://github.com/jkapa0417/tokenova/issues)
- 큰 기능 추가는 먼저 이슈로 논의 부탁드려요.

## 후원

이 프로젝트가 마음에 든다면 [GitHub Sponsors](https://github.com/sponsors/jkapa0417)를 통해 후원할 수 있어요 (활성화 예정).

---

<div align="center">

> 만든 사람 · **junki.ahn**
> 만든 곳 · 한국, 늦은 밤 ☕
>
> *Crafted in Seoul, late at night.*

</div>
