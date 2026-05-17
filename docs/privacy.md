🇰🇷 한국어 · [🇬🇧 English](privacy.en.md)

# Privacy

**현재 빌드 (v0.1.0) 기준** 어떤 데이터가 어디에 저장되는지. 이후 버전에서 opt-in 기반 기능 (커뮤니티 공유 등)이 추가되면 그에 맞춰 이 문서가 업데이트됩니다.

## 한 줄 요약

**현재 빌드는 토큰 사용 로그를 외부 서버로 전송하지 않습니다.** 외부 네트워크에 닿는 케이스는 단 두 가지 — (1) 자동 업데이트 매니페스트 체크, (2) Google Fonts CDN. 둘 다 토큰 데이터와 무관.

## 무엇이 어디에

### 로컬에만 저장되는 것

| 데이터 | 저장 위치 | 형태 |
|---|---|---|
| 토큰 이벤트 (timestamp + 토큰량 + provider + 세션 id) | OS 사용자 데이터 디렉터리의 `tokenova.sqlite3` | SQLite 테이블 |
| 세션 메타 (시작/종료, 누적 토큰, 행성 트리거 여부) | 동일 DB | SQLite |
| 매일의 우주 (별/행성/별자리/은하 등급) | 동일 DB | SQLite |
| 사용자 설정 (locale, custom provider 경로) | 동일 DB의 `settings` 테이블 | SQLite |
| Watcher high-water marks | 동일 DB의 `watch_state` 테이블 | SQLite |

DB 파일 위치 (OS별):

| OS | 경로 |
|---|---|
| macOS | `~/Library/Application Support/com.tokenova.app/tokenova.sqlite3` |
| Linux | `~/.local/share/com.tokenova.app/tokenova.sqlite3` |
| Windows | `%APPDATA%\com.tokenova.app\tokenova.sqlite3` |

이 파일은 사용자 본인만 읽을 수 있는 권한으로 생성 (OS 기본 user-dir permission). 백업하려면 그 파일 하나만 복사하면 됩니다. 완전 삭제하려면 그 파일만 지우면 됩니다.

### 외부와 통신하는 케이스 — 두 가지뿐

#### 1. 자동 업데이트 매니페스트 체크

- **언제**: 앱 시작 후 3초 뒤 1회 (`src/updater.ts`)
- **어디로**: `https://github.com/jkapa0417/tokenova/releases/latest/download/latest.json` (HTTPS, GitHub의 정적 파일)
- **무엇을 전송**: 단지 GET 요청. 사용자 식별자 / 토큰 데이터 / 사용 통계 — **0 byte 전송**.
- **응답 처리**: latest.json의 `version` 필드와 현재 앱 버전 비교. 더 높으면 banner 표시.
- **비활성화**: `src/updater.ts`의 `startUpdateCheck()` 호출 제거 + tauri.conf.json의 `plugins.updater.endpoints` 비우기 (개인 포크 시).

#### 2. Google Fonts CDN

- **언제**: 앱 webview 최초 로드 시 1회
- **어디로**: `fonts.googleapis.com` + `fonts.gstatic.com`
- **다운로드**: Geist (sans) + JetBrains Mono (mono) woff2 파일
- **저장**: webview 캐시 → 이후 오프라인 동작
- **전송 데이터**: 표준 HTTP 헤더 (Referer로 앱 origin, User-Agent로 webview 정보). 토큰 데이터 일체 X.
- **비활성화 원하면**: `index.html`의 `<link>` 태그 제거 → 시스템 폰트(Apple SD Gothic Neo / Pretendard / Noto) fallback.

### Telemetry / 사용 통계 — 현재 빌드는 없음

- 현재 빌드에는 분석 SDK 미포함.
- 자동 충돌 리포팅 없음.
- 사용자 ID / 디바이스 ID 추적 없음.

> 향후 버전에서 opt-in 기반의 사용 통계나 충돌 리포팅을 추가할 수 있습니다. 추가될 경우 release notes에 명시하고, 기본은 off + 사용자가 명시적으로 켜야 동작하는 형태로 도입합니다.

## Provider 로그는 누가 보나

- **Tokenova 백엔드만**. Rust 측 watcher가 fs::read로 직접 읽고 `{ timestamp, total_tokens }` 두 값만 추출.
- 원본 프롬프트 / 응답 / 코드 — 전혀 보지 않음, 저장하지 않음.
- 백엔드가 추출한 토큰 카운트는 SQLite로 저장되며 프론트엔드 webview에 표시.

```rust
// 실제 파싱 (src-tauri/src/parser/) — 토큰 카운트만 추출:
TokenEvent {
    timestamp: chrono::Utc,
    total_tokens: u64,
    provider: "claude_code" | "codex_cli" | "opencode",
    session_id: Option<i64>,
}
```

## 트레이 알림

OS 네이티브 알림 시스템 (macOS Notification Center / Windows Toast / Linux libnotify)을 사용. 알림 내용은 **로컬 OS만 본다** — 메시지가 클라우드(예: iCloud)로 동기화되지 않도록 사용자가 OS 설정에서 끌 수 있음.

## 우주 데이터 export / 삭제

- **Export**: 현재 GUI에서 직접 export 기능은 없음. DB 파일 자체를 복사하면 됨.
- **삭제**: 앱 종료 후 DB 파일 삭제 → 다음 실행 시 빈 상태로 시작.
- **선택적 삭제**: SQLite 클라이언트로 `DELETE FROM token_events WHERE …` 가능. 단, 별/행성/업적이 cascade로 영향받을 수 있음.

## 코드 서명 미적용 안내

v0.1.0 시점 배포물은 macOS Developer ID / Windows EV cert로 서명되지 않았습니다. 이는 **악성 코드 여부와 무관** — 단지 Apple/Microsoft에 비용을 지불하고 인증서를 받는 단계를 거치지 않은 것뿐. v1.0.0에서 정식 서명 예정.

전체 소스가 공개되어 있으니 의심되면 직접 빌드 가능: [`../README.md#build-from-source`](../README.md#build-from-source).

## 문의

개인정보 관련 우려는 [GitHub Issues](https://github.com/jkapa0417/tokenova/issues)로 (private는 jkapa0417 GitHub 프로필의 연락처로).
