// Webview UI: Loggerタブ - 3Dグラフ (X/Y/Z軌跡、ドラッグ回転・ホイールズーム・再生)
import { ClampState } from '../models/types';
import { clear, el, icon } from './common';
import { CLAMP_MAX_COLOR, CLAMP_MIN_COLOR, fmtNum, fmtTime, timeGradientColor } from './chartUtils';
import { ChartColumn, ChartRow } from './loggerRows';

const VB_W = 860;
const VB_H = 420;
const POINT_LIMIT = 4000;

interface Point3D {
  t: number;
  x: number;
  y: number;
  z: number;
  clamp: ClampState;
}

let axisItemIds: { x: string | null; y: string | null; z: string | null } = { x: null, y: null, z: null };
let rotation = { azimuth: -0.6, elevation: 0.35 };
let zoom = 1;
let playbackT: number | null = null;
let playTimer: number | null = null;

export function stopThreeDPlayback(): void {
  if (playTimer !== null) {
    clearInterval(playTimer);
    playTimer = null;
  }
}

export function renderThreeDTab(container: HTMLElement, rows: ChartRow[], columns: ChartColumn[]): void {
  const validIds = new Set(columns.map((c) => c.id));
  if (axisItemIds.x && !validIds.has(axisItemIds.x)) axisItemIds.x = null;
  if (axisItemIds.y && !validIds.has(axisItemIds.y)) axisItemIds.y = null;
  if (axisItemIds.z && !validIds.has(axisItemIds.z)) axisItemIds.z = null;
  if (!axisItemIds.x && columns[0]) axisItemIds.x = columns[0].id;
  if (!axisItemIds.y && columns[1]) axisItemIds.y = columns[1].id;
  if (!axisItemIds.z && columns[2]) axisItemIds.z = columns[2].id;

  const rerender = () => renderThreeDTab(container, rows, columns);

  clear(container);
  const layout = el('div', { style: 'display:flex;gap:18px;align-items:flex-start' });
  layout.append(buildAxisPanel(columns, rerender), buildPlotArea(rows, columns, rerender));
  container.appendChild(layout);
}

function buildAxisPanel(columns: ChartColumn[], rerender: () => void): HTMLElement {
  const panel = el('div', { style: 'width:220px;flex:0 0 220px' });
  panel.appendChild(el('div', { class: 'sub', style: 'text-transform:uppercase;font-size:10.5px;margin:0 0 6px' }, ['座標設定']));

  (['x', 'y', 'z'] as const).forEach((axis) => {
    const row = el('div', { style: 'margin-bottom:8px' });
    row.appendChild(el('label', { style: 'display:block;font-size:11px;margin-bottom:2px' }, [`${axis.toUpperCase()}軸`]));
    const select = el('select') as HTMLSelectElement;
    select.appendChild(el('option', { value: '' }, ['（未選択）']) as HTMLOptionElement);
    for (const col of columns) {
      const opt = el('option', { value: col.id }, [`${col.name} (${col.unit})`]) as HTMLOptionElement;
      if (col.id === axisItemIds[axis]) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      axisItemIds[axis] = select.value || null;
      rerender();
    });
    row.appendChild(select);
    panel.appendChild(row);
  });

  if (columns.length < 3) {
    panel.appendChild(el('div', { class: 'sub' }, ['3軸ぶんの項目がこのプロファイルに割り当てられていません。']));
  }
  return panel;
}

function buildPlotArea(rows: ChartRow[], columns: ChartColumn[], rerender: () => void): HTMLElement {
  const area = el('div', { style: 'flex:1;min-width:0' });

  if (!axisItemIds.x || !axisItemIds.y || !axisItemIds.z) {
    area.appendChild(el('div', { class: 'sub' }, ['X/Y/Zそれぞれに項目を選択してください。']));
    return area;
  }

  const points = buildPoints(rows.slice(-POINT_LIMIT), axisItemIds.x, axisItemIds.y, axisItemIds.z);
  if (points.length < 2) {
    area.appendChild(el('div', { class: 'sub' }, ['軌跡を描画できるデータがありません（X/Y/Zが同時に得られる時刻が必要です）。']));
    return area;
  }

  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  if (playbackT === null || playbackT < tMin) playbackT = tMax;

  const toolbar = el('div', { class: 'toolbar' }, [
    el('span', { class: 'sub', style: 'margin:0' }, ['ドラッグで回転・ホイールでズーム']),
    el('div', { class: 'spacer' }),
    button('視点リセット', () => {
      rotation = { azimuth: -0.6, elevation: 0.35 };
      zoom = 1;
      rerender();
    }),
  ]);
  area.appendChild(toolbar);

  const xItem = columns.find((c) => c.id === axisItemIds.x)!;
  const yItem = columns.find((c) => c.id === axisItemIds.y)!;
  const zItem = columns.find((c) => c.id === axisItemIds.z)!;
  area.appendChild(
    el('div', { class: 'sub', style: 'margin-bottom:6px' }, [
      `X: ${xItem.name} (${xItem.unit})　Y: ${yItem.name} (${yItem.unit})　Z: ${zItem.name} (${zItem.unit})`,
    ])
  );

  const wrap = el('div', { style: 'position:relative;display:flex;gap:14px' });
  const svgHost = el('div', { style: 'flex:1;min-width:0' });
  const visiblePoints = points.filter((p) => p.t <= (playbackT as number));
  svgHost.innerHTML = buildSvg(visiblePoints, points, xItem.name, yItem.name, zItem.name);
  wrap.appendChild(svgHost);
  wrap.appendChild(buildColorBar(tMin, tMax));
  area.appendChild(wrap);

  const svgEl = svgHost.querySelector('svg');
  if (svgEl) attachDragRotateAndZoom(svgEl, rerender);

  area.appendChild(buildPlaybackBar(tMin, tMax, rerender));
  return area;
}

function buildPoints(rows: ChartRow[], xId: string, yId: string, zId: string): Point3D[] {
  const pts: Point3D[] = [];
  for (const row of rows) {
    const dx = row.values.get(xId);
    const dy = row.values.get(yId);
    const dz = row.values.get(zId);
    if (!dx || !dy || !dz) continue;
    if (dx.clamp === 'nc' || dy.clamp === 'nc' || dz.clamp === 'nc') continue;
    const clamp: ClampState =
      dx.clamp === 'max' || dy.clamp === 'max' || dz.clamp === 'max'
        ? 'max'
        : dx.clamp === 'min' || dy.clamp === 'min' || dz.clamp === 'min'
          ? 'min'
          : null;
    pts.push({ t: row.t, x: dx.value, y: dy.value, z: dz.value, clamp });
  }
  return pts;
}

function computeBounds(points: Point3D[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const zs = points.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    Math.max(...zs) - Math.min(...zs),
    1e-6
  );
  return { cx, cy, cz, span };
}

// 軸の向き: Z=上下(垂直)、X=前後、Y=左右。
// azimuth(水平ドラッグ)は垂直軸(Z)まわりにX/Y(水平面)を回転させ、
// elevation(垂直ドラッグ)はX(前後)とZ(上下)を回転させて見下ろし/見上げ角を変える。
function project(
  p: { x: number; y: number; z: number },
  bounds: { cx: number; cy: number; cz: number; span: number }
): { x: number; y: number } {
  const nx = (p.x - bounds.cx) / bounds.span; // 前後
  const ny = (p.y - bounds.cy) / bounds.span; // 左右
  const nz = (p.z - bounds.cz) / bounds.span; // 上下
  const { azimuth, elevation } = rotation;
  const cosA = Math.cos(azimuth);
  const sinA = Math.sin(azimuth);
  const x1 = nx * cosA - ny * sinA; // 回転後の前後(奥行き)
  const y1 = nx * sinA + ny * cosA; // 回転後の左右 -> 画面横方向
  const z1 = nz; // 上下はazimuthの影響を受けない
  const cosE = Math.cos(elevation);
  const sinE = Math.sin(elevation);
  const z2 = x1 * sinE + z1 * cosE; // 上下 -> 画面縦方向
  const scale = 150 * zoom;
  return { x: VB_W / 2 + y1 * scale, y: VB_H / 2 - z2 * scale };
}

function buildSvg(visible: Point3D[], all: Point3D[], xLabel: string, yLabel: string, zLabel: string): string {
  const bounds = computeBounds(all);
  const axisLen = 0.7;
  const origin = project({ x: bounds.cx, y: bounds.cy, z: bounds.cz }, bounds);
  const xEnd = project({ x: bounds.cx + axisLen * bounds.span, y: bounds.cy, z: bounds.cz }, bounds);
  const yEnd = project({ x: bounds.cx, y: bounds.cy + axisLen * bounds.span, z: bounds.cz }, bounds);
  const zEnd = project({ x: bounds.cx, y: bounds.cy, z: bounds.cz + axisLen * bounds.span }, bounds);

  let body = '';
  body += axisLine(origin, xEnd, '#c9c9c9', xLabel);
  body += axisLine(origin, yEnd, '#c9c9c9', yLabel);
  body += axisLine(origin, zEnd, '#c9c9c9', zLabel);

  const tMin = all[0].t;
  const tMax = all[all.length - 1].t;
  const span = tMax - tMin || 1;

  for (let i = 1; i < visible.length; i++) {
    const p0 = project(visible[i - 1], bounds);
    const p1 = project(visible[i], bounds);
    const frac = (visible[i].t - tMin) / span;
    const color = timeGradientColor(frac);
    body += `<line x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(
      1
    )}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;
  }
  for (const p of visible) {
    if (!p.clamp) continue;
    const proj = project(p, bounds);
    const color = p.clamp === 'max' ? CLAMP_MAX_COLOR : CLAMP_MIN_COLOR;
    body += `<circle cx="${proj.x.toFixed(1)}" cy="${proj.y.toFixed(1)}" r="4" fill="none" stroke="${color}" stroke-width="2"/>`;
  }
  if (visible.length > 0) {
    const cur = project(visible[visible.length - 1], bounds);
    body += `<circle cx="${cur.x.toFixed(1)}" cy="${cur.y.toFixed(1)}" r="5" fill="${timeGradientColor(
      (visible[visible.length - 1].t - tMin) / span
    )}" stroke="#fff" stroke-width="1.5"/>`;
  }

  return `<svg viewBox="0 0 ${VB_W} ${VB_H}" width="100%" height="380" style="display:block;cursor:grab">${body}</svg>`;
}

function axisLine(from: { x: number; y: number }, to: { x: number; y: number }, color: string, label: string): string {
  return (
    `<line x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}" stroke="${color}" stroke-width="1.5"/>` +
    `<text x="${to.x.toFixed(1)}" y="${to.y.toFixed(1)}" font-size="12" fill="#6e6e6e" font-family="ui-monospace,monospace">${escapeXml(label)}</text>`
  );
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildColorBar(tMin: number, tMax: number): HTMLElement {
  const grad = `linear-gradient(to bottom, ${timeGradientColor(1)}, ${timeGradientColor(0.5)}, ${timeGradientColor(0)})`;
  return el('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:6px;flex:0 0 60px' }, [
    el('div', { class: 'sub', style: 'margin:0;font-size:10px' }, ['経過時間']),
    el('div', { style: `width:14px;height:220px;border-radius:3px;background:${grad}` }),
    el('div', { style: 'display:flex;flex-direction:column;justify-content:space-between;height:220px;font-size:9px' }, [
      el('span', { class: 'mono sub', style: 'margin:0' }, [fmtTime(tMax)]),
      el('span', { class: 'mono sub', style: 'margin:0' }, [fmtTime((tMin + tMax) / 2)]),
      el('span', { class: 'mono sub', style: 'margin:0' }, [fmtTime(tMin)]),
    ]),
  ]);
}

function buildPlaybackBar(tMin: number, tMax: number, rerender: () => void): HTMLElement {
  const bar = el('div', { class: 'toolbar', style: 'margin-top:10px' });

  const playBtn = el('button', {}, [
    icon(playTimer !== null ? 'debug-pause' : 'play'),
    playTimer !== null ? '一時停止' : '再生',
  ]) as HTMLButtonElement;
  playBtn.addEventListener('click', () => {
    if (playTimer !== null) {
      stopThreeDPlayback();
    } else {
      if (playbackT === null || playbackT >= tMax) playbackT = tMin;
      const stepAmount = (tMax - tMin) / 150 || 0.01;
      playTimer = window.setInterval(() => {
        playbackT = (playbackT ?? tMin) + stepAmount;
        if (playbackT >= tMax) {
          playbackT = tMax;
          stopThreeDPlayback();
        }
        rerender();
      }, 60);
    }
    rerender();
  });

  const slider = el('input', {
    type: 'range',
    min: String(tMin),
    max: String(tMax),
    step: String((tMax - tMin) / 1000 || 0.001),
    value: String(playbackT ?? tMax),
    style: 'flex:1',
  }) as HTMLInputElement;
  slider.addEventListener('input', () => {
    stopThreeDPlayback();
    playbackT = parseFloat(slider.value);
    rerender();
  });

  const readout = el('span', { class: 'mono' }, [`${fmtNum(playbackT ?? tMax, 3)}s / ${fmtNum(tMax, 3)}s`]);

  bar.append(playBtn, slider, readout);
  return bar;
}

// mousemove/mouseup は再レンダリングのたびにsvgEl(新しい要素)へ登録し直すと
// window上に古いリスナーが積み重なってしまうため、モジュール読み込み時に一度だけ
// 登録し、"今どの再描画関数を呼ぶか" を activeRerender で差し替える方式にする。
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartAzimuth = 0;
let dragStartElevation = 0;
let activeRerender: (() => void) | null = null;
let rafPending = false;

function scheduleRerender(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    activeRerender?.();
  });
}

window.addEventListener('mousemove', (ev) => {
  if (!dragging) return;
  const dx = ev.clientX - dragStartX;
  const dy = ev.clientY - dragStartY;
  rotation = {
    azimuth: dragStartAzimuth + dx * 0.01,
    elevation: Math.max(-1.5, Math.min(1.5, dragStartElevation - dy * 0.01)),
  };
  scheduleRerender();
});
window.addEventListener('mouseup', () => {
  dragging = false;
});

function attachDragRotateAndZoom(svgEl: SVGElement, rerender: () => void): void {
  activeRerender = rerender;
  svgEl.addEventListener('mousedown', (ev) => {
    const mouseEv = ev as MouseEvent;
    dragging = true;
    dragStartX = mouseEv.clientX;
    dragStartY = mouseEv.clientY;
    dragStartAzimuth = rotation.azimuth;
    dragStartElevation = rotation.elevation;
  });
  svgEl.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const wheelEv = ev as WheelEvent;
    zoom = Math.max(0.3, Math.min(4, zoom * (wheelEv.deltaY > 0 ? 0.9 : 1.1)));
    rerender();
  });
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', {}, [label]) as HTMLButtonElement;
  b.addEventListener('click', onClick);
  return b;
}
