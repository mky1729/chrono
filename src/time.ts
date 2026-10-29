export const NOW = 2026;
const BASE_YEARS = 50;
const FUTURE_COMPRESSION = 0.06;

// 非線形の時間座標: 同じ横幅が同じ経過年数を表すわけではない。
// 現代に近い時代は細かく、遠い過去・未来は大きく圧縮する。
export function toWorld(year: number): number {
  const delta = year - NOW;
  if (delta <= 0) return -Math.log10(1 + Math.abs(delta) / BASE_YEARS);
  return Math.log10(1 + delta / BASE_YEARS) * FUTURE_COMPRESSION;
}

export function fromWorld(world: number): number {
  if (world <= 0) return NOW - BASE_YEARS * (10 ** -world - 1);
  return NOW + BASE_YEARS * (10 ** (world / FUTURE_COMPRESSION) - 1);
}

export const START = toWorld(-13_800_000_000) - 0.18;
export const END = toWorld(1e100) + 0.18;
export const FULL_SPAN = END - START;
export const MIN_SPAN = 0.000006;

export type Camera = { center: number; span: number };
export const INITIAL_CAMERA: Camera = { center: (START + END) / 2, span: FULL_SPAN };

export function clampCamera(camera: Camera): Camera {
  const span = Math.max(MIN_SPAN, Math.min(FULL_SPAN, camera.span));
  return {
    span,
    center: Math.max(START + span / 2, Math.min(END - span / 2, camera.center)),
  };
}

export function zoomAt(camera: Camera, multiplier: number, relativeX: number): Camera {
  const anchor = camera.center + (relativeX - 0.5) * camera.span;
  const span = Math.max(MIN_SPAN, Math.min(FULL_SPAN, camera.span * multiplier));
  return clampCamera({ center: anchor - (relativeX - 0.5) * span, span });
}

export function location(world: number, camera: Camera): number {
  return ((world - camera.center) / camera.span + 0.5) * 100;
}

function clean(value: number, decimals = 1): string {
  return Number(value.toFixed(decimals)).toLocaleString('ja-JP');
}

export function formatYear(year: number): string {
  if (!Number.isFinite(year)) return '遠い未来';
  const delta = year - NOW;
  if (delta > 0) {
    if (delta >= 1e20) return '約10の' + Math.round(Math.log10(delta)) + '乗年後';
    if (delta >= 1e8) return '約' + clean(delta / 1e8) + '億年後';
    if (delta >= 1e4) return '約' + clean(delta / 1e4) + '万年後';
    return '約' + clean(delta, 0) + '年後';
  }
  const age = NOW - year;
  if (age >= 1e8) return '約' + clean(age / 1e8) + '億年前';
  if (age >= 1e4) return '約' + clean(age / 1e4) + '万年前';
  if (year <= 0) return '紀元前' + (1 - Math.round(year)).toLocaleString('ja-JP') + '年';
  return Math.round(year).toLocaleString('ja-JP') + '年';
}

export function zoomLevel(camera: Camera): number {
  return Math.max(0, Math.log2(FULL_SPAN / camera.span));
}

export function zoomCaption(camera: Camera): string {
  const z = zoomLevel(camera);
  if (z < 1) return '宇宙全体';
  if (z < 3.5) return '地球と文明';
  if (z < 6) return '時代を探索';
  if (z < 10) return '詳しい歴史';
  if (z < 15) return '年単位の歴史';
  return '時間を詳しく';
}

export type Tick = { world: number; label: string };

export function makeTicks(camera: Camera, viewportWidth: number): Tick[] {
  const leftWorld = camera.center - camera.span / 2;
  const rightWorld = camera.center + camera.span / 2;
  const points = [
    -13_800_000_000, -10_000_000_000, -5_000_000_000, -4_540_000_000,
    -3_000_000_000, -1_000_000_000, -500_000_000, -200_000_000,
    -100_000_000, -10_000_000, -1_000_000, -100_000,
    -10_000, -1000, 1, 1000, 2026, 1e9, 1e14, 1e40, 1e100,
  ];
  const minYear = fromWorld(leftWorld);
  const maxYear = fromWorld(rightWorld);

  // 歴史時代を拡大したときは、100年/10年/1年などの等間隔の目盛りを加える。
  const yearRange = maxYear - minYear;
  if (yearRange > 0 && yearRange < 2e7) {
    const magnitude = 10 ** Math.floor(Math.log10(yearRange / 7));
    const step = [1, 2, 5, 10].map(n => n * magnitude).find(n => yearRange / n <= 12) ?? magnitude * 10;
    const first = Math.ceil(minYear / step) * step;
    for (let i = 0; i < 250; i++) {
      const year = first + i * step;
      if (year > maxYear) break;
      points.push(year);
    }
  }

  const candidates = Array.from(new Set(points))
    .map(year => ({ world: toWorld(year), label: formatYear(year) }))
    .filter(p => p.world > leftWorld && p.world < rightWorld)
    .sort((a, b) => a.world - b.world);

  // 読めないほど目盛りを重ねない。
  const visible: Tick[] = [];
  let lastX = -Infinity;
  for (const point of candidates) {
    const x = ((point.world - leftWorld) / camera.span) * viewportWidth;
    if (x - lastX < (viewportWidth < 600 ? 92 : 110)) continue;
    visible.push(point);
    lastX = x;
  }
  return visible;
}
