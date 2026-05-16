# Reference: Interactive Universe (줌/팬/별자리)

> Phase D 메인 — 줌/팬/별자리 잇기 인터랙션. 시뮬레이션 검증 완료.
> **이 문서의 일부 파라미터는 `00-design-modifications.md`에서 오버라이드됨. 그 문서를 먼저 참조.**

## 검증된 기능

- 마우스 휠 줌 (커서 기준 줌인/아웃)
- 드래그로 팬 이동
- 별 클릭으로 별자리 잇기
- 빈 공간 클릭으로 별자리 완성
- 별 hover 시 황금 후광
- 2단계 별자리 라인 (글로우 + 메인)
- 자동 별자리 이름 생성 (한국어)
- 5가지 별자리 색 순환

## 핵심 데이터

| 항목 | 값 |
|---|---|
| 줌 범위 | ⚠️ `1x ~ 8x` (modifications 참조) |
| 줌 스텝 | 1.15x per scroll |
| 별 크기 줌 보정 | `Math.max(0.5, Math.sqrt(zoom))` |
| 드래그 임계점 | 3px (이하면 클릭) |
| 별 hit-test 반지름 | `Math.max(8, radius × zoom + 6)` |
| 호버 후광 색 | `rgba(255, 220, 100, 0.6)` |
| 별자리 라인 글로우 | 6px, 색 30% |
| 별자리 라인 메인 | 2px, 색 90% |
| 최소 별자리 별 수 | 2개 (완성 가능) |
| 카메라 팬 경계 | ⚠️ 1배 화면 안으로 clamp (modifications 참조) |

## 별자리 색 5종 (순환)

```typescript
const CONSTELLATION_COLORS = [
  { main: 'rgba(255, 200, 130, 0.9)', glow: 'rgba(255, 180, 80, 0.35)' },   // 황금
  { main: 'rgba(140, 200, 255, 0.9)', glow: 'rgba(80, 150, 255, 0.35)' },   // 파랑
  { main: 'rgba(220, 160, 255, 0.9)', glow: 'rgba(180, 100, 255, 0.35)' },  // 보라
  { main: 'rgba(150, 255, 200, 0.9)', glow: 'rgba(80, 220, 150, 0.35)' },   // 청록
  { main: 'rgba(255, 170, 200, 0.9)', glow: 'rgba(255, 100, 160, 0.35)' },  // 분홍
];
```

## 별자리 자동 이름

```typescript
const SUBJECTS = ['사슴', '곰', '용', '학', '여우', '거북', '사자', '늑대',
                  '백조', '독수리', '나비', '뱀', '말', '돌고래', '호랑이'];
const ADJECTIVES = ['빛나는', '잠든', '날아가는', '춤추는', '고요한',
                    '깨어난', '어린', '늙은', '북쪽의', '남쪽의'];

function generateConstellationName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const s = SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)];
  return `${a} ${s}자리`;
}
```

## 좌표 변환

```typescript
function worldToScreen(wx: number, wy: number, view: View): { x: number; y: number } {
  return {
    x: (wx - view.x) * view.zoom,
    y: (wy - view.y) * view.zoom,
  };
}

function screenToWorld(sx: number, sy: number, view: View): { x: number; y: number } {
  return {
    x: sx / view.zoom + view.x,
    y: sy / view.zoom + view.y,
  };
}
```

## 별 Hit-test

```typescript
function findStarAt(screenX: number, screenY: number, stars: Star[], view: View): Star | null {
  // DPR 고려 (display 480 vs canvas 960)
  const sx = screenX * 2;
  const sy = screenY * 2;
  let closest: Star | null = null;
  let closestDist = 18;
  for (const star of stars) {
    const s = worldToScreen(star.x, star.y, view);
    const dist = Math.hypot(s.x - sx, s.y - sy);
    const pickR = Math.max(8, star.radius * view.zoom + 6);
    if (dist < pickR && dist < closestDist) {
      closestDist = dist;
      closest = star;
    }
  }
  return closest;
}
```

## 별자리 라인 그리기 (2단계)

```typescript
function drawConstellationLines(
  ctx: CanvasRenderingContext2D,
  constellation: { starIds: number[] },
  stars: Star[],
  view: View,
  mainColor: string,
  glowColor: string,
) {
  if (constellation.starIds.length < 2) return;

  const draw = (color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < constellation.starIds.length - 1; i++) {
      const s1 = stars.find((s) => s.id === constellation.starIds[i]);
      const s2 = stars.find((s) => s.id === constellation.starIds[i + 1]);
      if (!s1 || !s2) continue;
      const p1 = worldToScreen(s1.x, s1.y, view);
      const p2 = worldToScreen(s2.x, s2.y, view);
      if (first) {
        ctx.moveTo(p1.x, p1.y);
        first = false;
      }
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();
  };

  draw(glowColor, 6);
  draw(mainColor, 2);
}
```

## 줌 이벤트 (커서 기준)

```typescript
container.addEventListener('wheel', (e) => {
  e.preventDefault();
  const pos = getEventPos(e);
  const worldPos = screenToWorld(pos.x * 2, pos.y * 2, view);  // *2 = DPR
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  // ⚠️ 줌 범위: 1x ~ 8x (modifications 적용)
  view.zoom = Math.max(1, Math.min(8, view.zoom * factor));
  // 커서 아래 좌표 유지
  view.x = worldPos.x - (pos.x * 2) / view.zoom;
  view.y = worldPos.y - (pos.y * 2) / view.zoom;
  // ⚠️ 줌 후 카메라 clamp 필요 (modifications 참조)
  clampCamera(view);
  requestRender();
}, { passive: false });
```

## TypeScript 포팅 시 변경점

### 1. DPR (Device Pixel Ratio)

```typescript
const dpr = window.devicePixelRatio || 1;
canvas.width = 480 * dpr;
canvas.height = 400 * dpr;
canvas.style.width = '480px';
canvas.style.height = '400px';
ctx.scale(dpr, dpr);
```

### 2. requestAnimationFrame

```typescript
let needsRender = false;
function requestRender() {
  if (needsRender) return;
  needsRender = true;
  requestAnimationFrame(() => {
    render();
    needsRender = false;
  });
}
```

### 3. 데이터는 백엔드에서

```typescript
async function loadCurrentUniverse() {
  const universe = await invoke('get_current_universe');
  stars = universe.stars;
  planets = universe.planets;
  nebulae = universe.nebulae;
  constellations = universe.constellations;
  requestRender();
}
```

### 4. 별자리 저장은 백엔드로

```typescript
async function saveConstellation(name: string, starIds: number[], color: string) {
  await invoke('save_constellation', { name, starIds, color });
}
```

### 5. 실시간 별 추가 (이벤트 리스닝)

```typescript
import { listen } from '@tauri-apps/api/event';

await listen<Star>('star_added', (event) => {
  stars.push(event.payload);
  requestRender();
});
```

## Phase D 작업 순서

1. 렌더링 코어 포팅 (drawNebula → drawStars → drawPlanets → render)
2. 카메라 클래스 (worldToScreen, screenToWorld, **clampCamera**)
3. 마우스 이벤트 (mousedown/move/up/leave + wheel)
4. 별 hit-test
5. 별자리 상태 관리 (current vs completed)
6. 별자리 라인 렌더링 (2단계)
7. 자동 이름 생성
8. 백엔드 연동 (load + save + listen)
