// 時系列・3Dグラフ共通のユーティリティ (配色・書式)。
// クランプ表示色 (amber=MAX, violet=MIN) と衝突しない、系列識別専用の定性配色。
const PALETTE = ['#0d9488', '#db2777', '#1d4ed8', '#65a30d', '#ea580c', '#7c3aed', '#0891b2', '#be123c'];

export function paletteColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export const CLAMP_MAX_COLOR = '#b45309';
export const CLAMP_MIN_COLOR = '#6d28d9';

export function fmtNum(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(digits);
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function fmtTime(t: number): string {
  return `${t.toFixed(3)}s`;
}

/** 経過時間の割合(0〜1)から、青→紫→amberのグラデーション色を返す。 */
export function timeGradientColor(frac: number): string {
  const stops: { t: number; c: [number, number, number] }[] = [
    { t: 0, c: [37, 99, 235] }, // #2563eb
    { t: 0.5, c: [124, 58, 237] }, // #7c3aed
    { t: 1, c: [217, 119, 6] }, // #d97706
  ];
  const clamped = Math.min(1, Math.max(0, frac));
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i].t && clamped <= stops[i + 1].t) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const span = b.t - a.t || 1;
  const local = (clamped - a.t) / span;
  const r = Math.round(a.c[0] + (b.c[0] - a.c[0]) * local);
  const g = Math.round(a.c[1] + (b.c[1] - a.c[1]) * local);
  const bl = Math.round(a.c[2] + (b.c[2] - a.c[2]) * local);
  return `rgb(${r},${g},${bl})`;
}
