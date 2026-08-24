// Webview UI: Loggerタブ - 時系列グラフ
import { DecodedValue, LoggerCategory } from '../models/types';
import { clear, el } from './common';
import { CLAMP_MAX_COLOR, CLAMP_MIN_COLOR, fmtNum, fmtTime, paletteColor } from './chartUtils';
import { LoggerColumn, LoggerRow } from './loggerRows';

const VB_W = 860;
const VB_H = 380;
const MARGIN = { left: 56, right: 20, top: 16, bottom: 30 };
const ROW_LIMIT = 4000;

let selectedItemIds = new Set<string>();
let mode: 'raw' | 'normalized' = 'raw';
let pickerFilter = '';

export function renderTimeSeriesTab(
  container: HTMLElement,
  rows: LoggerRow[],
  columns: LoggerColumn[],
  categories: LoggerCategory[]
): void {
  const validIds = new Set(columns.map((c) => c.item.id));
  for (const id of [...selectedItemIds]) if (!validIds.has(id)) selectedItemIds.delete(id);

  const rerender = () => renderTimeSeriesTab(container, rows, columns, categories);

  const colorForItem = new Map<string, string>();
  columns.forEach((c, i) => colorForItem.set(c.item.id, paletteColor(i)));

  clear(container);
  const layout = el('div', { style: 'display:flex;gap:18px;align-items:flex-start' });
  layout.append(
    buildPicker(columns, categories, colorForItem, rerender),
    buildChartArea(rows.slice(-ROW_LIMIT), columns, colorForItem, rerender)
  );
  container.appendChild(layout);
}

function buildPicker(
  columns: LoggerColumn[],
  categories: LoggerCategory[],
  colorForItem: Map<string, string>,
  rerender: () => void
): HTMLElement {
  const wrap = el('div', { style: 'width:230px;flex:0 0 230px' });

  const search = el('input', {
    type: 'text',
    value: pickerFilter,
    placeholder: '項目を検索',
    style: 'margin-bottom:6px',
  }) as HTMLInputElement;
  search.addEventListener('input', () => {
    pickerFilter = search.value;
    rerender();
  });
  wrap.appendChild(search);

  if (columns.length === 0) {
    wrap.appendChild(el('div', { class: 'sub' }, ['このプロファイルには項目が割り当てられていません。']));
    return wrap;
  }

  const byCategory = new Map<number, LoggerColumn[]>();
  for (const c of columns) {
    if (pickerFilter && !c.item.name.toLowerCase().includes(pickerFilter.toLowerCase())) continue;
    const arr = byCategory.get(c.item.categoryNumber) ?? [];
    arr.push(c);
    byCategory.set(c.item.categoryNumber, arr);
  }

  for (const [catNum, cols] of [...byCategory.entries()].sort((a, b) => a[0] - b[0])) {
    const catName = categories.find((c) => c.number === catNum)?.name ?? '';
    wrap.appendChild(
      el('div', { class: 'sub', style: 'margin:10px 0 2px;text-transform:uppercase;font-size:10.5px' }, [
        `${catNum}: ${catName}`,
      ])
    );
    for (const col of cols) {
      const row = el('label', {
        style: 'display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:12px',
      });
      const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
      cb.checked = selectedItemIds.has(col.item.id);
      cb.addEventListener('change', () => {
        if (cb.checked) selectedItemIds.add(col.item.id);
        else selectedItemIds.delete(col.item.id);
        rerender();
      });
      const swatch = el('span', {
        style: `display:inline-block;width:10px;height:10px;border-radius:2px;background:${colorForItem.get(
          col.item.id
        )};margin-left:auto`,
      });
      row.append(cb, el('span', {}, [col.item.name]), swatch);
      wrap.appendChild(row);
    }
  }
  return wrap;
}

function buildChartArea(
  rows: LoggerRow[],
  columns: LoggerColumn[],
  colorForItem: Map<string, string>,
  rerender: () => void
): HTMLElement {
  const area = el('div', { style: 'flex:1;min-width:0' });
  const selectedCols = columns.filter((c) => selectedItemIds.has(c.item.id));

  const rawBtn = el('button', { class: mode === 'raw' ? 'primary' : '' }, ['実値']) as HTMLButtonElement;
  rawBtn.addEventListener('click', () => {
    mode = 'raw';
    rerender();
  });
  const normBtn = el('button', { class: mode === 'normalized' ? 'primary' : '' }, ['正規化 0-100%']) as HTMLButtonElement;
  normBtn.addEventListener('click', () => {
    mode = 'normalized';
    rerender();
  });
  area.appendChild(
    el('div', { class: 'toolbar' }, [
      el('span', {}, ['表示:']),
      el('div', { class: 'segmented' }, [rawBtn, normBtn]),
      el('span', { class: 'sub', style: 'margin:0 0 0 8px' }, [
        '▲=MAX到達　▼=MIN到達（点で表示、線色は項目識別用）',
      ]),
    ])
  );

  if (rows.length === 0) {
    area.appendChild(el('div', { class: 'sub' }, ['表示できるデータがありません。']));
    return area;
  }
  if (selectedCols.length === 0) {
    area.appendChild(el('div', { class: 'sub' }, ['左の一覧から表示する項目を選んでください。']));
    return area;
  }

  const legend = el('div', { style: 'display:flex;gap:14px;flex-wrap:wrap;margin-bottom:6px;font-size:11.5px' });
  for (const col of selectedCols) {
    legend.appendChild(
      el('span', {}, [
        el('span', {
          style: `display:inline-block;width:12px;height:3px;background:${colorForItem.get(
            col.item.id
          )};margin-right:5px;vertical-align:2px`,
        }),
        `${col.item.name} (${col.item.unit})`,
      ])
    );
  }
  area.appendChild(legend);

  const { svg, tMin, tMax } = buildSvg(rows, selectedCols, colorForItem, mode);
  const svgHost = el('div', { style: 'position:relative' });
  svgHost.innerHTML = svg;
  area.appendChild(svgHost);

  const svgEl = svgHost.querySelector('svg');
  if (svgEl) attachHoverTooltip(svgHost, svgEl, rows, selectedCols, colorForItem, tMin, tMax);

  return area;
}

function buildSvg(
  rows: LoggerRow[],
  cols: LoggerColumn[],
  colorForItem: Map<string, string>,
  mode: 'raw' | 'normalized'
): { svg: string; tMin: number; tMax: number } {
  const tMin = rows[0].t;
  const tMax = rows[rows.length - 1].t;
  const plotW = VB_W - MARGIN.left - MARGIN.right;
  const plotH = VB_H - MARGIN.top - MARGIN.bottom;
  const xOf = (t: number) => MARGIN.left + (tMax === tMin ? 0 : ((t - tMin) / (tMax - tMin)) * plotW);

  // 系列ごとの値域を事前計算 (raw=全系列共通 / normalized=系列ごと)
  const seriesValid: DecodedValue[][] = cols.map((c) =>
    rows.map((r) => r.values.get(c.item.id)).filter((d): d is DecodedValue => !!d && d.clamp !== 'nc')
  );
  let sharedLo = 0;
  let sharedHi = 1;
  if (mode === 'raw') {
    const all = seriesValid.flat().map((d) => d.value);
    sharedLo = all.length ? Math.min(...all) : 0;
    sharedHi = all.length ? Math.max(...all) : 1;
    if (sharedLo === sharedHi) {
      sharedLo -= 1;
      sharedHi += 1;
    }
  }
  const ranges = cols.map((_, i) => {
    if (mode === 'raw') return { lo: sharedLo, hi: sharedHi };
    const vals = seriesValid[i].map((d) => d.value);
    let lo = vals.length ? Math.min(...vals) : 0;
    let hi = vals.length ? Math.max(...vals) : 1;
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    return { lo, hi };
  });
  const yOf = (value: number, seriesIdx: number) => {
    const { lo, hi } = ranges[seriesIdx];
    const norm = (value - lo) / (hi - lo);
    return MARGIN.top + (1 - norm) * plotH;
  };

  let body = '';
  for (let i = 0; i <= 4; i++) {
    const y = MARGIN.top + (plotH / 4) * i;
    body += `<line x1="${MARGIN.left}" y1="${y}" x2="${VB_W - MARGIN.right}" y2="${y}" stroke="#e5e5e5" stroke-width="1"/>`;
  }
  body += `<line x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${VB_H - MARGIN.bottom}" stroke="#c9c9c9"/>`;
  body += `<line x1="${MARGIN.left}" y1="${VB_H - MARGIN.bottom}" x2="${VB_W - MARGIN.right}" y2="${VB_H - MARGIN.bottom}" stroke="#c9c9c9"/>`;

  cols.forEach((col, i) => {
    const color = colorForItem.get(col.item.id)!;
    let segment: string[] = [];
    const segments: string[][] = [];
    for (const row of rows) {
      const d = row.values.get(col.item.id);
      if (!d || d.clamp === 'nc') {
        if (segment.length) segments.push(segment);
        segment = [];
        continue;
      }
      segment.push(`${xOf(row.t).toFixed(1)},${yOf(d.value, i).toFixed(1)}`);
    }
    if (segment.length) segments.push(segment);
    for (const seg of segments) {
      if (seg.length < 2) continue;
      body += `<polyline points="${seg.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    for (const row of rows) {
      const d = row.values.get(col.item.id);
      if (!d || d.clamp === null || d.clamp === 'nc') continue;
      const x = xOf(row.t);
      const y = yOf(d.value, i);
      body +=
        d.clamp === 'max'
          ? `<polygon points="${x - 4},${y + 6} ${x + 4},${y + 6} ${x},${y - 2}" fill="${CLAMP_MAX_COLOR}"/>`
          : `<polygon points="${x - 4},${y - 6} ${x + 4},${y - 6} ${x},${y + 2}" fill="${CLAMP_MIN_COLOR}"/>`;
    }
  });

  body += `<text x="${MARGIN.left}" y="${VB_H - 8}" font-size="10" fill="#9a9a9a" font-family="ui-monospace,monospace">${fmtTime(tMin)}</text>`;
  body += `<text x="${VB_W - MARGIN.right}" y="${VB_H - 8}" font-size="10" fill="#9a9a9a" text-anchor="end" font-family="ui-monospace,monospace">${fmtTime(tMax)}</text>`;

  const svg = `<svg viewBox="0 0 ${VB_W} ${VB_H}" width="100%" height="340" style="display:block">${body}</svg>`;
  return { svg, tMin, tMax };
}

function attachHoverTooltip(
  hostEl: HTMLElement,
  svgEl: SVGElement,
  rows: LoggerRow[],
  cols: LoggerColumn[],
  colorForItem: Map<string, string>,
  tMin: number,
  tMax: number
): void {
  const tooltip = el('div', {
    style:
      'position:absolute;pointer-events:none;background:var(--vscode-editorHoverWidget-background,#fff);' +
      'border:1px solid var(--vscode-editorHoverWidget-border,#ccc);border-radius:4px;padding:6px 8px;' +
      'font-size:11px;display:none;z-index:10;white-space:nowrap',
  });
  hostEl.appendChild(tooltip);

  svgEl.addEventListener('mousemove', (ev) => {
    const mouseEv = ev as MouseEvent;
    const rect = svgEl.getBoundingClientRect();
    const relX = ((mouseEv.clientX - rect.left) / rect.width) * VB_W;
    const plotW = VB_W - MARGIN.left - MARGIN.right;
    const frac = (relX - MARGIN.left) / plotW;
    if (frac < 0 || frac > 1) {
      tooltip.style.display = 'none';
      return;
    }
    const t = tMin + frac * (tMax - tMin);

    let nearest = rows[0];
    let bestDiff = Math.abs(rows[0].t - t);
    for (const r of rows) {
      const diff = Math.abs(r.t - t);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = r;
      }
    }

    clear(tooltip);
    tooltip.appendChild(el('div', { class: 'mono', style: 'font-weight:600;margin-bottom:3px' }, [fmtTime(nearest.t)]));
    for (const col of cols) {
      const d = nearest.values.get(col.item.id);
      tooltip.appendChild(
        el('div', {}, [
          el('span', {
            style: `display:inline-block;width:8px;height:8px;background:${colorForItem.get(
              col.item.id
            )};margin-right:5px;border-radius:2px`,
          }),
          `${col.item.name}: ${d ? (d.clamp === 'nc' ? 'N.C.' : `${fmtNum(d.value)} ${col.item.unit}`) : '—'}`,
        ])
      );
    }
    tooltip.style.display = 'block';
    tooltip.style.left = `${mouseEv.clientX - rect.left + 12}px`;
    tooltip.style.top = `${mouseEv.clientY - rect.top + 12}px`;
  });
  svgEl.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
}
