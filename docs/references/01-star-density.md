# Reference: Star Density Test

> Phase D — 별/안개/행성 렌더링의 기본 레퍼런스. 시뮬레이션에서 검증된 시각 파라미터.

## 검증된 사실

- 480x400px 우주 영역에서 **300별이 시각적 스위트 스팟**
- 별 1개 = 1,000 토큰
- 70% 작은 별 / 25% 중간 / 5% 큰 별
- 85% 흰색 / 8% 따뜻한 색 / 7% 차가운 색
- 큰 별(radius > 3)은 radial gradient glow 추가
- 안개는 2~4개의 보라/파랑/분홍/청록 radial gradient

## 핵심 파라미터 (변경 X)

| 항목 | 값 |
|---|---|
| 캔버스 표시 사이즈 | 480 x 400px |
| 캔버스 내부 사이즈 | 960 x 800px (2x DPR) |
| 배경색 | `#0a0a14` |
| 별 크기 분포 | 70/25/5 (small/mid/large) |
| 별 색 분포 | 85/8/7 (white/warm/cool) |
| 별 opacity | 0.6 ~ 1.0 (랜덤) |
| 큰 별 기준 | radius > 3 |
| 큰 별 glow | radius × 3, opacity × 0.4 |
| 안개 개수 | 2~4개 |
| 안개 반지름 | 100~350 |
| 안개 opacity | 0.05~0.06 |

## 시드 RNG (mulberry32)

```typescript
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

## 안개 색 팔레트

```typescript
const NEBULA_COLORS = [
  'rgba(120, 80, 180,',  // 보라
  'rgba(80, 120, 200,',  // 파랑
  'rgba(200, 100, 140,', // 분홍
  'rgba(80, 180, 160,',  // 청록
];
```

## 별 생성 함수

```typescript
interface Star {
  id: number;
  x: number;
  y: number;
  radius: number;
  color: [number, number, number];  // RGB
  opacity: number;
  big: boolean;  // radius > 3
}

function generateStar(id: number, x: number, y: number, rng: () => number): Star {
  const sizeRoll = rng();
  let radius: number;
  if (sizeRoll < 0.7) radius = 1 + rng() * 1.5;
  else if (sizeRoll < 0.95) radius = 2 + rng() * 1.5;
  else radius = 3.5 + rng() * 2;

  const colorRoll = rng();
  let color: [number, number, number];
  if (colorRoll < 0.85) color = [255, 255, 255];
  else if (colorRoll < 0.93) color = [255, 220, 170];
  else color = [170, 210, 255];

  return {
    id, x, y, radius, color,
    opacity: 0.6 + rng() * 0.4,
    big: radius > 3,
  };
}
```

## 렌더 순서 (반드시 지킬 것)

1. 배경 fill (`#0a0a14`)
2. 안개 (radial gradient)
3. **별자리 라인** (별 아래에 그려야 별이 위로 보임)
4. 별 (big star glow → 호버 후광 → 별 본체 → 별자리 외곽 링)
5. 행성 (최상단)
