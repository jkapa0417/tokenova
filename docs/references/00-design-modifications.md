# Design Modifications (오버라이드)

> 빌드 플랜 / 레퍼런스 시뮬레이션의 일부 결정을 오버라이드함.
> **이 문서가 가장 우선순위가 높음.**

## 1. 별자리: 프리셋 + 사용자 커스텀 둘 다 지원

**원래 플랜**: 사용자가 별 클릭으로 직접 잇는 별자리만 지원.

**변경**: 두 가지 모드 모두 지원.

### 1-A. 사용자 커스텀 별자리 (기존 메커니즘 유지)
- 별 클릭 → 별자리 시작/별 추가
- 빈 공간 클릭 → 별자리 완성 (별 2개 이상)
- 자동 이름 생성 또는 사용자 입력
- 자정에 영구 보존 (편집 X)

### 1-B. 프리셋 천문학 별자리 (신규)
- 실제 88개 공식 별자리 도안 (오리온, 큰곰자리, 백조자리 등)
- 사용자가 라이브러리에서 선택 → 우주에 적용
- 별의 패턴 매칭 또는 사용자가 별 매핑

### 미해결 설계 (Phase D/E에서 확정 필요)

- **데이터 구조**: 프리셋 별자리 정의 형식 (상대 좌표? 별 ID 매핑?)
- **적용 방식 후보**:
  - A) 시스템이 자동으로 우주의 별 패턴과 매칭 시도
  - B) 사용자가 라이브러리에서 별자리 선택 → 별 하나씩 클릭으로 매핑
  - C) 별자리 도안을 ghost 오버레이로 보여주고 사용자가 확정
- **UI 위치**: 별도 탭? 별자리 잇기 모드 토글?
- **저장**: 프리셋 사용 시 `constellations` 테이블에 `preset_id` 컬럼 추가?

**액션**: Phase E 시작 전 위 항목 확정.

## 2. 줌 범위: 1x ~ 8x (줌아웃 제거)

**원래**: 0.3x ~ 8x

**변경**: 1x ~ 8x

**이유**: 1배 미만 줌아웃 시 우주가 화면보다 작아져 빈 공간 노출. 1배가 우주 전체 뷰의 베이스라인.

**코드 영향**:
```typescript
// universe/camera.ts
view.zoom = Math.max(1, Math.min(8, view.zoom * factor));
//              ^^^^^^ 0.3 → 1
```

## 3. 카메라 팬 경계: 우주 화면을 벗어나지 않게

**원래**: 무제한 팬 가능.

**변경**: 1배 화면 (= 우주 영역 480×400 logical, 960×800 internal) 안으로 카메라 clamp.

**의미**:
- 1배에서는 팬 불가능 (정확히 우주 전체가 화면에 들어옴)
- 2배 줌에서는 좌우상하 절반씩 팬 가능
- 8배 줌에서는 7/8씩 팬 가능

**clampCamera 알고리즘**:
```typescript
function clampCamera(view: View, canvasW: number, canvasH: number) {
  // 우주 좌표는 [0, canvasW] × [0, canvasH] (DPR 적용된 internal size)
  // view.x, view.y는 화면 좌상단의 world 좌표
  // 줌 z에서 화면이 보여주는 world 영역의 폭 = canvasW / z

  const visibleW = canvasW / view.zoom;
  const visibleH = canvasH / view.zoom;

  // 화면이 우주 안에 머물도록
  const maxX = canvasW - visibleW;  // 0이면 1배 (팬 불가)
  const maxY = canvasH - visibleH;

  view.x = Math.max(0, Math.min(maxX, view.x));
  view.y = Math.max(0, Math.min(maxY, view.y));
}
```

**호출 시점**:
- 드래그 팬 중 (mousemove)
- 휠 줌 후 (커서 기준 줌으로 카메라 위치 변경되므로)
- 줌인할 때 우주 끝에 가까이 있으면 자동으로 안쪽으로 끌려옴

## 4. 일일 별 캡 300 → 1,000

**원래**: 300별 (시뮬레이션에서 "시각적 스위트 스팟"으로 검증).

**변경**: **1,000별**.

**이유**: 실사용자의 일일 토큰 양을 고려하면 300은 너무 빨리 도달. 1,000으로 늘려서 의미 있는 진척감 유지.

**토큰→별 매핑**: 1K 토큰 = 1별 (변경 없음).
**캡 도달 토큰**: 300K → **1M 토큰**.

## 5. galaxy_type 6등급 재정의

별 수에 따라 자정 마감 시 분류:

| star_count | galaxy_type |
|---|---|
| 0 | `black_hole` |
| 1~30 | `nebula` |
| 31~100 | `cluster` |
| 101~300 | `galaxy` |
| 301~999 | `mega_galaxy` |
| 1000 (캡) | `super_cluster` |

## 6-pre. Nebula 생성 = 시드 기반 랜덤 (확정 반복)

새 우주 생성 시 한 번. 우주의 `seed`에서 파생된 RNG로:

- **개수**: 2~4개 (`rng.gen_range(2..=4)`)
- **위치**: `(rng.gen() * UNIVERSE_W, rng.gen() * UNIVERSE_H)`
- **반지름**: `100 + rng.gen() * 250`
- **색**: 보라/파랑/분홍/청록 4종 중 random
- **opacity**: 0.05 + rng.gen() * 0.01

**확정성**: 같은 우주 = 같은 안개. **다양성**: 매일 새 우주 = 매일 새 안개. 사용자 액션 영향 없음.

## 6. 행성 위치 = 랜덤 배치

세션 트리거 시점에 빈자리 랜덤 배치. 우주 생성 시 자리 예약 안 함. 별/기존 행성과 최소 거리 유지.

**일일 행성 캡**: 10개 (mythic 제외 모든 등급 합산).

## 7. 자정 마감 = 로컬 시간

`chrono::Local` 기준. KST 23:59 → 00:00에 finalize + 새 우주 생성. UTC 아님.

## 변경 영향 요약

| 항목 | 변경 전 | 변경 후 | 영향 받는 파일 |
|---|---|---|---|
| 줌 최소값 | 0.3 | 1 | `universe/camera.ts`, `universe/interaction.ts` |
| 팬 경계 | 없음 | clampCamera | `universe/camera.ts` |
| 별자리 종류 | 커스텀만 | 프리셋 + 커스텀 | `engine/constellation.rs`, DB schema |
| 일일 별 캡 | 300 | **1,000** | `engine/stars.rs`, `commands.rs` (UI 표시) |
| galaxy_type 등급 | 4종 | **6종** | `engine/universe.rs::classify_galaxy` |
| 행성 위치 | (미정) | **랜덤 배치** | `engine/planets.rs::find_empty_position` |
| 자정 타이머 | (미정) | **chrono::Local** | `engine/universe.rs::next_local_midnight` |
