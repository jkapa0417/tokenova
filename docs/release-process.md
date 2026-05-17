🇰🇷 한국어 · [🇬🇧 English](release-process.en.md)

# Release Process

태그 푸시 한 번으로 3 OS 빌드 + 서명 + GitHub Release publish + 자동 업데이트 매니페스트 생성까지 끝남. 사람 손은 버전 bump + tag 뿐.

## 사전 1회 셋업 (포크/처음 한 번만)

1. **서명 키페어 생성**
   ```bash
   npx tauri signer generate -w ~/.tauri/tokenova.key -p ""
   cat ~/.tauri/tokenova.key.pub  # → 공개키 복사
   ```
2. **공개키를 conf에**: `src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`에 위에서 복사한 한 줄을 박음.
3. **비공개키를 GitHub Secret에**: `~/.tauri/tokenova.key` 내용을 통째로 https://github.com/jkapa0417/tokenova/settings/secrets/actions → `TAURI_SIGNING_PRIVATE_KEY` 로 등록.
4. **Workflow 권한**: Settings → Actions → General → Workflow permissions → **"Read and write permissions"** 선택.

## 정기 릴리스 절차

### 1. 버전 bump

세 곳 동기화 필수:

```jsonc
// package.json
"version": "1.0.0"
```
```jsonc
// src-tauri/tauri.conf.json
"version": "1.0.0"
```
```toml
# src-tauri/Cargo.toml
version = "1.0.0"
```

> ⚠️ **WiX 주의**: Windows MSI를 빌드한다면 pre-release suffix는 **숫자만** 허용 (`0.1.0-1` OK, `0.1.0-rc.1` ❌). 우리 현재 빌드는 NSIS EXE만이라 제약 없음. MSI 추가하면 다시 주의.

```bash
cargo check --release  # 컴파일 확인
npm run tauri build     # (선택) 로컬 검증
```

### 2. Commit + push

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Bump to v1.0.0"
git push origin main
```

### 3. 태그 생성 + push

**정식 릴리스** (live):
```bash
git tag v1.0.0
git push origin v1.0.0
```

**Prerelease (RC, beta 등)** — 태그 이름에 `-` 포함:
```bash
git tag v1.0.0-rc.1
git push origin v1.0.0-rc.1
```

워크플로의 `prerelease: ${{ contains(github.ref_name, '-') }}`가 dash 감지하면 자동으로 GitHub Release에 "Pre-release" 배지 + `/releases/latest/download/` alias 제외.

### 4. CI가 알아서 함

태그 push 순간 `.github/workflows/release.yml`이 트리거:

| Job | Runner | 산출물 | 시간 |
|---|---|---|---|
| `publish-tauri` matrix | macos-latest | `Tokenova_X.Y.Z_universal.dmg` + `.app.tar.gz` + `.sig` | ~25-35분 |
| | windows-latest | `Tokenova_X.Y.Z_x64-setup.exe` + `.nsis.zip` + `.sig` | ~10-15분 |
| | ubuntu-22.04 | `tokenova_X.Y.Z_amd64.AppImage` + `.deb` + `.sig` | ~8-12분 |

추가로 자동 생성:
- `latest.json` (auto-updater 매니페스트)

모든 자산이 `https://github.com/jkapa0417/tokenova/releases/tag/vX.Y.Z` 에 올라옴.

### 5. 모니터링

https://github.com/jkapa0417/tokenova/actions

- 🟡 진행 중 / ✅ 성공 / ❌ 실패 색깔로 즉시 파악
- 각 job 클릭 → 단계별 로그
- 실패 step 펼치면 에러 메시지

### 6. 검증 + 공지

3 OS 다 끝나면:

1. Release 페이지 확인 — 자산 6개+1개 (`latest.json`) 다 올라와있는지
2. 한 플랫폼에서라도 다운받아 설치 + 실행 검증
3. (live release인 경우) 이전 버전 사용자가 banner 받기 시작 — 보통 5-15분 후

## 자주 만나는 실패 케이스

### "Resource not accessible by integration"

**원인**: workflow가 GitHub Release를 만들 권한이 없음.
**해결**: Settings → Actions → General → Workflow permissions → "Read and write permissions". 그 다음 실패한 run "Re-run failed jobs".

### "Couldn't find release with tag" + 같은 commit 재시도 실패

**원인**: 세 job이 동시에 release 생성 시도하면서 race condition.
**해결**: 보통 자동 회복하지만, 안 되면 GitHub Releases 페이지에서 부분적으로 만들어진 release 수동 삭제 후 워크플로 재실행.

### WiX MSI 다운로드 502 (Windows job)

**원인**: GitHub의 WiX toolset CDN 일시적 장애.
**해결**: 재실행 (transient). NSIS EXE만 빌드한다면 이 다운로드 자체가 없음.

### 키 검증 실패 ("could not verify signature")

**원인**: `tauri.conf.json`의 pubkey와 release 서명에 쓰인 private key가 불일치.
**해결**: pubkey 확인 → public key의 정확한 한 줄을 conf에 박았는지 검토. 또는 `TAURI_SIGNING_PRIVATE_KEY` secret이 올바른 private key 파일 내용인지 확인.

## 롤백 / 잘못된 release 회수

### 사용자에게 아직 전파 안 됐을 때

1. GitHub Releases 페이지 → 해당 release의 ⋯ → **Delete**
2. 태그 삭제: `git push --delete origin vX.Y.Z` + `git tag -d vX.Y.Z`
3. 수정 후 다시 같은 태그 또는 다른 태그로 재배포

### 사용자가 이미 잘못된 버전을 받음

1. **새 버전 (vX.Y.Z+1) 빠르게 publish** — auto-updater가 자연스럽게 다시 잡음
2. 이전 잘못된 release를 GitHub에서 **prerelease로 strip** 또는 삭제 — `/releases/latest/download/` alias가 새 버전 가리키도록

> minisign 서명은 release를 invalidate 못 함 (이미 사용자가 가진 binary). 따라서 보안 critical 문제면 banner로 알리고 새 버전 push.

## 매니페스트 미리보기

빌드 끝나면 `latest.json` 확인:

```bash
curl -s https://github.com/jkapa0417/tokenova/releases/latest/download/latest.json | jq .
```

`version`, `platforms.darwin-aarch64.url`, `platforms.darwin-aarch64.signature` 등이 정상 채워졌는지 검토.

## 빠른 참조

```bash
# 정식 릴리스
git tag v1.0.0 && git push origin v1.0.0

# Prerelease (테스트)
git tag v1.0.0-rc.1 && git push origin v1.0.0-rc.1

# 태그 삭제 (잘못 푸시한 경우)
git push --delete origin v1.0.0-rc.1
git tag -d v1.0.0-rc.1
```
