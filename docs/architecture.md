🇰🇷 한국어 · [🇬🇧 English](architecture.en.md)

# Architecture

Tauri 2 데스크톱 앱. Rust 백엔드 + Vanilla TypeScript 프론트엔드 + SQLite 단일 파일 저장. 모바일/웹 안 함, 한 프로세스 안에서 다 끝남.

## 모듈 맵

```
src-tauri/src/
├── lib.rs                ── Tauri Builder 셋업 + 트레이 + 윈도우
├── commands.rs           ── 프론트엔드가 invoke하는 명령 (28개)
├── db/mod.rs             ── SQLite 스키마 + 모든 쿼리
├── watcher/
│   ├── mod.rs            ── 공통 watcher 헬퍼 (notify crate)
│   ├── claude_code.rs    ── ~/.claude/projects/*.jsonl 파서
│   ├── codex_cli.rs      ── ~/.codex/sessions/**/*.jsonl 파서
│   └── opencode.rs       ── SQLite 5초 폴링
├── session.rs            ── 5분 idle 세션 / 20M 토큰 강제 트리거
├── engine/
│   ├── mod.rs            ── 토큰 → 별, 세션 close → 행성 발견
│   ├── universe.rs       ── 일일 우주 생성 (seed, layout, palette, cluster name)
│   ├── stars.rs          ── 별 좌표 분포 (날짜 시드 기반 결정적)
│   ├── planets.rs        ── 행성 등급 룰렛 + 빈자리 배치
│   ├── catalog.rs        ── 30종 행성 정적 정의 + 한국어 fallback 이름
│   ├── achievements.rs   ── 18가지 업적 트리거 로직
│   ├── nebula.rs         ── 배경 성운 배치 (장식 only)
│   ├── codex.rs          ── 행성 발견 카운트 (코덱스 백엔드)
│   └── types.rs          ── 공유 타입 + Rarity / GalaxyType
├── notifier.rs           ── OS 트레이 알림 (3-level policy, daily cap 5)
├── i18n.rs               ── 백엔드 측 KO/EN 문자열 (알림 / 행성명 / 업적명 / 은하 등급)
├── parser/               ── JSONL 한 줄을 (timestamp, total_tokens)로 변환
└── dev_console.rs        ── debug 전용 HTTP 콘솔 (E2E 트리거)
```

```
src/
├── main.ts               ── 탭 라우팅 + 토큰 pill 폴링 + 트레이 메뉴 라우트 수신
├── views/
│   ├── today.ts          ── 라이브 우주 + HUD + 드로잉 바
│   ├── codex.ts          ── 행성/별/별자리 3개 서브탭
│   ├── achievements.ts   ── 18개 카드 + 카테고리 탭
│   ├── gallery.ts        ── 1주/1개월/365일 히트맵 + 오버레이
│   ├── settings.ts       ── Provider health + 언어 + 버전/업데이트
│   ├── discovery.ts      ── 행성 발견 풀스크린 오버레이
│   └── modal.ts          ── 공통 modal 헬퍼
├── universe/
│   ├── renderer.ts       ── 캔버스 rAF 루프 (별·성운·배경·constellations)
│   ├── camera.ts         ── view (x, y, zoom) + worldToScreen 변환
│   ├── interaction.ts    ── 휠 zoom / 드래그 pan / 클릭
│   ├── catalog.ts        ── 30종 행성 정적 정의 (TS 측, Rust와 동기)
│   ├── star-shapes.ts    ── 14종 별 형태 (캔버스 드로잉 함수 + 도감 메타)
│   ├── effects.ts        ── 슈팅 스타 / 더스트 / 무드
│   ├── planet-canvas.ts  ── 각 행성을 회전하는 작은 캔버스로 마운트
│   └── planet-mount.ts   ── data-planet-orb 요소 자동 마운트/dispose
├── i18n/
│   ├── index.ts          ── t() / setLocale() / subscribeLocale() / applyDomI18n()
│   └── locales/{ko,en}.ts ── ~280 키 양 locale 사전 (TS 타입으로 누락 키 컴파일 에러)
└── updater.ts            ── 시작 시 check + footer banner + pending 상태 export
```

## 이벤트 흐름

```
Provider 로그 변경
     │
     ↓ notify (Linux/Mac) / ReadDirectoryChangesW (Win)
   Watcher (Rust)
     │
     │ TokenEvent { provider, timestamp, total_tokens, ... }
     ↓ broadcast::Sender
   ┌───────────────────────────────┐
   │  SessionManager               │  ── 5분 idle 닫힘 / 20M chunk 트리거
   │   - DB.bump_session_tokens()  │
   │   - DB.close_session()        │
   └──────────┬────────────────────┘
              │ ClosedSession { id, total_tokens }
              ↓ broadcast::Sender
   ┌───────────────────────────────┐
   │  Engine                       │  ── 토큰 → 별, 세션 → 행성
   │   - stars::plan_star_addit()  │
   │   - planets::discover_for_..()│
   │   - achievements::on_*()      │
   │   - Notifier (KO/EN locale)   │
   │   - app.emit("planet_discov")│
   │   - set_tray_discovery(true)  │
   └──────────┬────────────────────┘
              │ Tauri event
              ↓
   ┌───────────────────────────────┐
   │  Frontend                     │
   │   - poll current_universe(3s) │
   │   - listen("stars_added")     │
   │   - listen("planet_discov")   │
   │   - listen("tray-route")      │
   └───────────────────────────────┘
```

## 영속성

`tokenova.sqlite3` 한 파일. OS별 위치:

| OS | 경로 |
|---|---|
| macOS | `~/Library/Application Support/com.tokenova.app/` |
| Linux | `~/.local/share/com.tokenova.app/` |
| Windows | `%APPDATA%\com.tokenova.app\` |

테이블:
- `universes` — 일별 1행 (date · seed · layout_shape · palette · cluster_name · star_count · galaxy_type)
- `token_events` — 모든 원시 토큰 이벤트 (provider · timestamp · total_tokens · session_id)
- `sessions` — 세션 메타 (started_at · last_activity · total_tokens · planet_triggered)
- `stars` · `planets` · `nebulae` · `constellations` — 우주별 시각 자산
- `codex_entries` — 행성 종 발견 카운트
- `achievements` — 달성한 업적 키 + 일시
- `watch_state` · `settings` — 워처 high-water mark + 사용자 설정 (locale, provider 경로 등)

스키마 마이그레이션은 `db/mod.rs`의 `v1 → v2` 패턴 (`column_exists` + `ALTER TABLE`). foreign-key는 ON.

## 결정적 우주 생성

`engine/universe.rs::seed_from_date(date)`가 date를 64-bit hash로 변환 → 같은 날짜는 같은 seed → 같은 layout/palette/cluster name. 6종 layout (`spiral`/`elliptical`/`irregular`/`dual_cluster`/`scattered`/`core_heavy`) 중 modulo로 선택. 별 개별 위치는 `(seed, star_index)` 조합으로 jitter → 같은 토큰량이라도 매일 다른 별자리 분포.

## 자정 롤오버 3중 안전

1. **전용 타이머** — `tokio::time::sleep` 으로 정확히 자정에 깨어남
2. **토큰 이벤트 lazy 체크** — 새 이벤트 도착 시 `refresh_date_if_needed` 호출 → 날짜 바뀌었으면 이전 universe finalize
3. **payload 폴링 lazy 체크** — 프론트엔드가 3초마다 `current_universe_payload`를 부르는데 그 안에서도 동일 체크

타이머가 OS suspend로 지연되어도, 새 이벤트 1건 또는 다음 poll 1회에 정확히 새 universe로 전환.

## Debug-only 모듈

- `dev_console.rs` — `#[cfg(debug_assertions)]` 가드. release 빌드에 포함 안 됨. 7777 포트에 HTTP listener 띄움 (`TOKENOVA_DEV_CONSOLE` env로 활성화).
- `lib.rs`의 트레이 셋업 한 블럭 — debug 빌드에서만 `set_decorations(true)` + `set_always_on_top(false)` 적용해 popover를 일반 창처럼 띄움.

자세한 사용은 [`../dev-console/README.md`](../dev-console/README.md).
