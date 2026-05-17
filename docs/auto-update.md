🇰🇷 한국어 · [🇬🇧 English](auto-update.en.md)

# Auto-Update

새 버전이 사용자에게 도달하는 흐름. Tauri 2 `tauri-plugin-updater` + minisign 서명 + GitHub Releases 매니페스트.

## 큰 그림

```
1.  개발자: 버전 bump + git tag v1.x.y + push
        ↓
2.  GitHub Actions: 3개 OS에서 빌드 + minisign 서명 (private key from secret)
        ↓
3.  GitHub Release: 산출물 + latest.json 자동 업로드
        ↓
4.  사용자 앱: 시작 후 3초 뒤 latest.json fetch
        ↓
5.  현재 버전 < manifest 버전 → 인앱 banner "v1.x.y 사용 가능"
        ↓
6.  사용자가 "지금 설치" 클릭 → 플랫폼 패키지 다운로드 → 서명 검증 → 적용 → 재시작
```

## 매니페스트 — `latest.json`

`tauri-action`이 build 후 자동 생성. 형태:

```json
{
  "version": "1.0.0",
  "notes": "릴리스 노트…",
  "pub_date": "2026-05-18T10:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "Tokenova_1.0.0_aarch64.app.tar.gz.sig 내용",
      "url": "https://github.com/jkapa0417/tokenova/releases/download/v1.0.0/Tokenova_1.0.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": { ... },
    "windows-x86_64": {
      "signature": "…",
      "url": "…Tokenova_1.0.0_x64-setup.nsis.zip"
    },
    "linux-x86_64": {
      "signature": "…",
      "url": "…tokenova_1.0.0_amd64.AppImage"
    }
  }
}
```

각 플랫폼별 URL이 **인스톨러가 아닌 업데이트 번들** (`.app.tar.gz` / `.nsis.zip` / `.AppImage`)을 가리킴 — 이게 업데이터 플러그인이 in-place 적용하는 형식.

## 서명

[`tauri signer generate`](https://v2.tauri.app/distribute/sign/)로 minisign 키페어 생성 — Ed25519, 비밀번호는 빈 문자열도 OK (CI secret으로 보호되므로).

```bash
npx tauri signer generate -w ~/.tauri/tokenova.key -p ""
# 출력:
#   Private: /home/junki_ahn/.tauri/tokenova.key
#   Public:  /home/junki_ahn/.tauri/tokenova.key.pub
```

- **공개키 (Public)** → `src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`에 박힘. 앱 binary에 포함되어 배포.
- **비공개키 (Private)** → **절대 git에 commit 금지**. GitHub Repo Secrets의 `TAURI_SIGNING_PRIVATE_KEY` 값으로만 존재.

빌드 시 `tauri-action`이 secret을 읽어 자동으로 산출물에 `.sig` 파일을 첨부. 사용자 앱은 다운로드한 번들의 서명을 빌트인 public key로 검증 → 위변조된 release면 설치 거부.

## 엔드포인트

`tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "endpoints": [
      "https://github.com/jkapa0417/tokenova/releases/latest/download/latest.json"
    ],
    "pubkey": "<base64 minisign public key>"
  }
}
```

**중요**: 엔드포인트는 `/releases/latest/download/…` alias 사용. GitHub의 "latest" 의미는:
- prerelease 아닌 + draft 아닌 가장 최근 release
- prerelease로 publish된 RC들은 자동으로 alias에서 제외 → 사용자에게 노출 안 됨

## 프론트엔드 흐름

`src/updater.ts`:

```typescript
// 시작 3초 뒤
await initI18n();
applyDomI18n();
// ... 뷰 셋업
setTimeout(() => void startUpdateCheck(), 3000);
```

`startUpdateCheck()`:
1. `await check()` — 플러그인이 latest.json fetch + 서명 검증 + 버전 비교
2. 결과가 있으면 (= 새 버전) `setPending(update)` 호출 → subscriber 알림
3. `dismissed` 안 됐으면 footer banner 띄움
4. 사용자가 "나중에" 누르면 dismissed=true (세션 동안 banner 안 띄움)
5. "지금 설치" 누르면 `update.downloadAndInstall()` + `relaunch()`

`installPendingUpdate()` 헬퍼는 Settings 탭의 "v1.x.y 설치" 버튼도 같은 흐름으로 트리거.

## 사용자 경험 4가지

| 상황 | 표시 |
|---|---|
| 처음 켰을 때 banner | 하단 footer 알림 (검정 반투명) — "새 버전 v1.x.y 사용 가능" + 2 버튼 |
| "나중에" 클릭 후 다시 보고 싶음 | Settings → 정보 → 버전 옆에 "v1.x.y 설치" 버튼 |
| 백그라운드 체크가 Settings 탭 열린 후 끝남 | `subscribeUpdates`가 자동으로 버튼 표시 |
| 다운로드 실패 | "설치 실패 — 다시 시도해주세요" 표시 + 버튼 "재시도" |

## 플랫폼별 in-place 동작

| OS | 업데이트 번들 | 적용 방식 |
|---|---|---|
| macOS | `.app.tar.gz` | Tokenova.app 풀고 swap, `relaunch()` |
| Windows | `.nsis.zip` (NSIS 자동 update) | 새 EXE 다운 + 백그라운드 설치 + 재시작 |
| Linux | `.AppImage` | 같은 위치에 새 AppImage 덮어쓰기 + chmod + relaunch |

`.deb` 사용자는 in-place 자동 업데이트 안 됨 (apt 권한 필요) — 그래서 우리는 `.AppImage`를 권장하고 `.deb`은 보조용.

## 키 분실 / 회전

private key를 분실하면 **모든 사용자가 새 키로 재서명된 release를 자동 검증 못 함** → 수동 재설치 필요. 따라서:

- `~/.tauri/tokenova.key` 별도 비밀번호 매니저(1Password 등)에 백업
- 정기 회전이 필요하면 새 키 생성 → public key 교체 → 매우 다음 release의 사용자는 "수동 다운로드" 안내 한 번 띄워야 함

## 디버깅 팁

- **에러 "Failed to fetch"**: 엔드포인트 URL 오타, 또는 release 자체가 없음/draft 상태
- **에러 "could not verify the signature"**: tauri.conf.json의 pubkey와 release를 만든 private key 불일치
- **사용자 측 "이미 최신" 인데 새 release 있는데도 안 잡힘**: 사용자 앱의 현재 버전 ≥ manifest의 버전. 정상.
- **업데이트는 잡혔는데 설치 후 재시작이 안 됨**: macOS는 `.app` quarantine 속성 때문일 수 있음. Apple Developer ID 서명되면 사라짐 (현재 미서명 상태).

## 코드 위치 빠른 참조

| 책임 | 파일 |
|---|---|
| 엔드포인트 + pubkey | `src-tauri/tauri.conf.json` |
| 플러그인 등록 | `src-tauri/src/lib.rs` (init Builder) |
| 권한 | `src-tauri/capabilities/default.json` (`updater:default`, `process:default`) |
| Cargo 의존성 | `src-tauri/Cargo.toml` (`tauri-plugin-updater`, `tauri-plugin-process`) |
| 프론트 호출 | `src/updater.ts` |
| Settings 통합 | `src/views/settings.ts` |
| CI 서명 | `.github/workflows/release.yml` (env `TAURI_SIGNING_PRIVATE_KEY`) |
