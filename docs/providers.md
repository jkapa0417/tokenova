🇰🇷 한국어 · [🇬🇧 English](providers.en.md)

# Provider Integrations

Tokenova가 토큰 사용을 어떻게 추적하는지. 각 provider는 로컬 파일을 직접 읽고, 그 데이터는 절대 외부로 안 나갑니다 ([Privacy](privacy.md) 참고).

## 지원 Provider 요약

| Provider | 기본 경로 (Linux · macOS) | Windows 기본 | 방식 |
|---|---|---|---|
| Claude Code | `~/.claude/projects/*.jsonl` | `%USERPROFILE%\.claude\projects\*.jsonl` | 파일 시스템 감시 (notify crate) |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `%USERPROFILE%\.codex\sessions\…` | 파일 시스템 감시 |
| OpenCode | `~/.local/share/opencode/opencode.db` | `%APPDATA%\opencode\opencode.db` | SQLite 5초 폴링 |

## Claude Code

- **무엇을 읽나**: 프로젝트별 JSONL 로그. Claude가 호출될 때마다 한 줄씩 append.
- **파싱**: `src-tauri/src/parser/`에서 각 줄을 `{ timestamp, total_tokens }` 튜플로 변환. `input_tokens + output_tokens` 합을 total로 잡음 (cache hit 분리 안 함).
- **첫 실행 우대**: 사용자가 앱 설치하기 전부터 쌓여있는 과거 JSONL 전체를 "이미 소비된" 것으로 마킹. `watch_state` 테이블에 bootstrap sentinel을 남겨, 다음 실행부터는 정상 tail.

## Codex CLI

- **무엇을 읽나**: OpenAI Codex CLI의 세션 rollout 파일. 날짜 디렉토리 구조 (`YYYY/MM/DD/`)에 chronological JSONL.
- **파싱**: 동일하게 한 줄당 `{ timestamp, total_tokens }`. Codex는 OpenAI Responses API의 usage 객체를 직접 기록 → `input_tokens + output_tokens` 합산.
- **재귀 watch**: 날짜 디렉토리가 매일 새로 생기는 패턴이라 root에 recursive watcher 붙음.

## OpenCode

- **무엇을 읽나**: SQLite DB. JSONL이 아니라 메시지/세션 테이블에서 토큰 카운트 직접 SELECT.
- **방식**: 5초마다 마지막 본 `time_updated` 이후 row만 가져옴. `watch_state`에 high-water mark 저장. 디스크 I/O 최소화 위해 `notify` 대신 polling 선택 (SQLite WAL은 외부 watcher가 알기 어려움).
- **첫 실행 우대**: 첫 실행 시 가장 최신 `time_updated` 직후로 high-water mark 점프 → 과거 메시지 전체 무시.

## 기본 경로가 안 맞을 때

OS 표준 위치를 안 쓰는 경우 (회사 정책으로 다른 경로, 또는 portable 설치) **Settings → LLM Providers** 에서 각 카드의 PATH 입력란을 채우고 저장. 변경은 **앱 재시작 후 적용** — watcher는 시작 시 한 번만 spawn.

### OpenCode 추가 경로 오버라이드

OpenCode 공식 환경변수 `OPENCODE_DATA_DIR`도 인식. 예:

```bash
export OPENCODE_DATA_DIR=/mnt/work/opencode-data
```

설정 시 우선순위: **앱 내 설정 (Settings) > `OPENCODE_DATA_DIR` env > OS 기본**.

## 트러블슈팅

### "활동 없음" 또는 "오늘 0건"

1. **Settings → LLM Providers** 카드의 상태 dot 확인:
   - 🟢 초록 = 경로가 정상 디렉터리/파일을 가리킴 + 종류도 맞음
   - 🟡 노랑 = 경로는 있는데 종류 불일치 (예: JSONL 디렉토리 자리에 파일이 있음)
   - 🔴 빨강 = 경로 자체가 없음
2. 실제 provider가 그 경로에 정말 로그를 쓰고 있는지 직접 확인:
   ```bash
   ls -la ~/.claude/projects/    # 또는 해당 provider의 위치
   tail -1 ~/.claude/projects/your-project/*.jsonl
   ```
3. 만약 디렉토리가 비어있다면 — 그 provider를 한 번 실제로 호출해보고 (예: `claude` CLI로 짧은 prompt 한 줄) Tokenova의 토큰 카운트가 늘어나는지 확인.

### 토큰이 너무 많이 잡힘

- 첫 실행 자동 skip이 안 됐을 수 있음. `watch_state` 테이블의 `bootstrapped_at` 행 확인. 없으면 모든 과거 로그를 다시 ingest함.
- DB 파일 위치: [Architecture](architecture.md#영속성).
- 완전 초기화 원하면 DB 파일 삭제 후 앱 재시작 → 빈 상태로 시작.

### Windows에서 `%APPDATA%\opencode\` 가 비어있음

OpenCode의 데이터 디렉터리 결정 로직이 macOS/Linux와 다름. v0.1.0 이전 OpenCode는 Linux/macOS 경로(`~/.local/share/opencode/`)를 Windows에도 적용한 버그가 있었음. 최신 OpenCode는 정상이지만, 구버전이면 다음 둘 중 하나:

- OpenCode 업데이트
- Settings에서 Windows 측 사용자 지정 경로로 `%USERPROFILE%\.local\share\opencode\opencode.db` 등록

## 새 Provider 추가하기 (PR 환영)

1. `src-tauri/src/watcher/<provider>.rs` 추가 — `spawn_<provider>_watcher(db, events_tx, first_run, override_dir)` 시그니처 따르기. (Claude Code 구현을 참고)
2. `src-tauri/src/parser/<provider>.rs` 추가 — JSONL/DB 한 row를 `{ timestamp, total_tokens }`로 변환.
3. `lib.rs`의 setup에서 spawn 호출 추가.
4. `commands.rs::default_path_for` / `display_name_for` / `kind_ok` 분기에 provider id 추가 → Settings UI에 자동 표시됨.
5. 새 provider 이름을 `i18n/locales/ko.ts` + `en.ts`에 추가 (필요한 경우).
