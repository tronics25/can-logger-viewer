// Webview UI: Loggerタブ - 時系列グラフ
import { ClampState, DecodedValue } from '../models/types';
import { clear, el } from './common';
import { CLAMP_MAX_COLOR, CLAMP_MIN_COLOR, fmtNum, fmtTime, paletteColor, unitSuffix } from './chartUtils';
import { buildCsvImportSection, getImportedChartData, mergeChartRows } from './csvImport';
import { ChartColumn, ChartRow } from './loggerRows';

const VB_W = 860;
const VB_H = 380;
const MARGIN = { left: 56, right: 20, top: 16, bottom: 30 };
const ROW_LIMIT = 4000;

let selectedItemIds = new Set<string>();
let mode: 'raw' | 'normalized' = 'raw';
let pickerFilter = '';
/** 項目ごとの線色の手動指定 (未指定ならpaletteColorの自動割り当てを使う)。 */
const colorOverrides = new Map<string, string>();
/** ホイールでズームした時間範囲。nullなら全範囲表示。 */
let zoomRange: { tMin: number; tMax: number } | null = null;

// 線色選択用のプリセットパレット。ネイティブの<input type="color">はVS Codeの
// サンドボックス化されたwebview内でOSカラーピッカーが正しく開かないことが
// あるため使わず、クリックで開く自前のスウォッチ一覧に置き換えている。
const COLOR_PRESETS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2',
  '#db2777', '#65a30d', '#4f46e5', '#ea580c', '#0d9488', '#be123c',
  '#334155', '#a16207', '#15803d', '#9333ea',
];

export function renderTimeSeriesTab(container: HTMLElement, baseRows: ChartRow[], baseColumns: ChartColumn[]): void {
  // 取り込み済みのCSVがあれば、Logger/固定フォーマットの系列と同じ時系列
  // として混ぜ込む。以降はこのallColumns/allRowsだけを使い、呼び出し元の
  // baseRows/baseColumnsを直接は参照しない。
  const imported = getImportedChartData();
  const columns = [...baseColumns, ...imported.columns];
  const rows = mergeChartRows(baseRows, imported.rows);

  const validIds = new Set(columns.map((c) => c.id));
  for (const id of [...selectedItemIds]) if (!validIds.has(id)) selectedItemIds.delete(id);

  // 別のログ/プロファイルに切り替わり、ズーム範囲が今のデータと重ならなく
  // なった場合はリセットする (空のグラフになってしまうのを防ぐ)。
  if (zoomRange && rows.length > 0) {
    const fullTMin = rows[0].t;
    const fullTMax = rows[rows.length - 1].t;
    if (zoomRange.tMax < fullTMin || zoomRange.tMin > fullTMax) zoomRange = null;
  }

  const rerender = () => renderTimeSeriesTab(container, baseRows, baseColumns);

  const colorForItem = new Map<string, string>();
  columns.forEach((c, i) => colorForItem.set(c.id, colorOverrides.get(c.id) ?? paletteColor(i)));

  clear(container);
  const layout = el('div', { style: 'display:flex;gap:18px;align-items:flex-start' });
  // ROW_LIMITによる間引きはここではなく、ズーム範囲を確定させたbuildChartArea内
  // (ズーム済みの表示範囲に対して)で行う。ここで先に末尾ROW_LIMIT件へ切り詰めて
  // しまうと、ログ全体が長い場合にログ前半が最初から失われ、「ズームリセット」を
  // 押しても真の先頭まで戻れなくなってしまう(実際に報告されたバグ)。
  layout.append(buildPicker(columns, colorForItem, rerender), buildChartArea(rows, columns, colorForItem, rerender));
  container.appendChild(layout);
}

/**
 * SVGの折れ線・マーカーが過剰に重くならないよう、必要な場合だけ等間隔に間引く。
 * 先頭・末尾の点は必ず保持する(tMin/tMaxの計算やズーム境界がズレないように)。
 * ズーム範囲確定後の「実際に表示する行」に対してのみ適用することで、ログ全体の
 * 長さに関わらず先頭が欠落することはない。
 */
function downsampleRows(rows: ChartRow[], limit: number): ChartRow[] {
  if (rows.length <= limit) return rows;
  const step = rows.length / limit;
  const out: ChartRow[] = [];
  for (let i = 0; i < limit; i++) {
    out.push(rows[Math.floor(i * step)]);
  }
  const last = rows[rows.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * 線色を選ぶ小さな正方形ボタン。クリックでプリセットパレットのポップアップを
 * 開く (VS Codeのwebview内ではネイティブ<input type="color">のOSダイアログが
 * 正しく開かないことがあるため使わない)。
 */
function buildColorSwatchButton(itemId: string, currentColor: string, rerender: () => void): HTMLElement {
  const btn = el('button', {
    type: 'button',
    title: '線の色を選択',
    style: `width:14px;height:14px;padding:0;border:1px solid var(--vscode-panel-border);border-radius:3px;background:${currentColor};flex:0 0 auto;cursor:pointer;`,
  }) as HTMLButtonElement;

  let popup: HTMLElement | null = null;
  let onDocClick: ((e: MouseEvent) => void) | null = null;

  function closePopup(): void {
    if (popup) {
      popup.remove();
      popup = null;
    }
    if (onDocClick) {
      document.removeEventListener('mousedown', onDocClick, true);
      onDocClick = null;
    }
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popup) {
      closePopup();
      return;
    }
    popup = el('div', {
      style:
        'position:absolute;z-index:20;display:grid;grid-template-columns:repeat(4,18px);gap:4px;' +
        'padding:6px;border:1px solid var(--vscode-panel-border);border-radius:5px;' +
        'background:var(--vscode-editor-background);box-shadow:0 2px 8px rgba(0,0,0,0.2);',
    });
    for (const color of COLOR_PRESETS) {
      const swatch = el('button', {
        type: 'button',
        title: color,
        style: `width:18px;height:18px;padding:0;border:1px solid var(--vscode-panel-border);border-radius:3px;background:${color};cursor:pointer;`,
      }) as HTMLButtonElement;
      swatch.addEventListener('click', (ev) => {
        ev.stopPropagation();
        colorOverrides.set(itemId, color);
        closePopup();
        rerender();
      });
      popup.appendChild(swatch);
    }
    document.body.appendChild(popup);
    const btnRect = btn.getBoundingClientRect();
    popup.style.left = `${btnRect.left + window.scrollX}px`;
    popup.style.top = `${btnRect.bottom + window.scrollY + 4}px`;

    onDocClick = (ev) => {
      if (popup && !popup.contains(ev.target as Node) && ev.target !== btn) closePopup();
    };
    document.addEventListener('mousedown', onDocClick, true);
  });

  return btn;
}

function buildPicker(columns: ChartColumn[], colorForItem: Map<string, string>, rerender: () => void): HTMLElement {
  const wrap = el('div', { style: 'width:230px;flex:0 0 230px' });

  // 別のデータソース(他のログ・実測値等)のCSVを、同じ時間軸のLogger/固定
  // フォーマット信号と重ねて比較できるようにする。取り込んだ列はcolumns
  // (呼び出し元でマージ済み)に混ざっているので、以降のグループ分け・
  // チェックボックス・色選択は他の項目と完全に同じ処理で扱われる。
  wrap.appendChild(buildCsvImportSection(rerender));

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
    wrap.appendChild(el('div', { class: 'sub' }, ['このプロファイルには項目が割り当てられていません。CSVを読み込んで比較することもできます。']));
    return wrap;
  }

  const byGroup = new Map<string, ChartColumn[]>();
  for (const c of columns) {
    if (pickerFilter && !c.name.toLowerCase().includes(pickerFilter.toLowerCase())) continue;
    const arr = byGroup.get(c.groupLabel) ?? [];
    arr.push(c);
    byGroup.set(c.groupLabel, arr);
  }

  for (const [groupLabel, cols] of [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    wrap.appendChild(
      el('div', { class: 'sub', style: 'margin:10px 0 2px;text-transform:uppercase;font-size:10.5px' }, [groupLabel])
    );
    for (const col of cols) {
      // スウォッチボタンをlabelの外に置く (label内にネストすると、環境に
      // よってはクリックがラベル経由でチェックボックスにも転送されてしまい
      // 挙動が不安定になるため、チェックボックス部分とスウォッチ部分を
      // はっきり分ける)。
      const row = el('div', { style: 'display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px' });
      const label = el('label', { style: 'display:flex;align-items:center;gap:6px;flex:1;min-width:0;cursor:pointer' });
      const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
      cb.checked = selectedItemIds.has(col.id);
      cb.addEventListener('change', () => {
        if (cb.checked) selectedItemIds.add(col.id);
        else selectedItemIds.delete(col.id);
        rerender();
      });
      label.append(cb, el('span', {}, [col.name]));
      const swatchBtn = buildColorSwatchButton(col.id, colorForItem.get(col.id)!, rerender);
      row.append(label, swatchBtn);
      wrap.appendChild(row);
    }
  }
  return wrap;
}

function buildChartArea(
  rows: ChartRow[],
  columns: ChartColumn[],
  colorForItem: Map<string, string>,
  rerender: () => void
): HTMLElement {
  const area = el('div', { style: 'flex:1;min-width:0' });
  const selectedCols = columns.filter((c) => selectedItemIds.has(c.id));

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
  const toolbar = el('div', { class: 'toolbar' }, [
    el('span', {}, ['表示:']),
    el('div', { class: 'segmented' }, [rawBtn, normBtn]),
    el('span', { class: 'sub', style: 'margin:0 0 0 8px' }, [
      '▲=MAXに到達/脱した瞬間　▼=MINに到達/脱した瞬間　/　ホイールで左右移動・＋－でズーム',
    ]),
  ]);

  if (rows.length === 0) {
    area.appendChild(el('div', { class: 'sub' }, ['表示できるデータがありません。']));
    area.appendChild(toolbar);
    return area;
  }

  const fullTMin = rows[0].t;
  const fullTMax = rows[rows.length - 1].t;

  area.appendChild(toolbar);

  // ズーム操作は「表示:」トグル+ヒント文と同じtoolbar(flex-wrap)を共有させず、
  // 専用の行として独立させる。同じ行を共有していると、パネル幅が狭くヒント文が
  // 折り返された際にflex:1のspacerがその折返し行側に取り込まれてほぼ潰れ、
  // ＋/－とリセットボタンが独自の行へ回り込む形になり、リセットボタンの
  // 有無で＋/－の位置が変わってしまっていた(初回クリック時とそれ以降で押下
  // 位置が変わる不具合の原因)。＋/－を常に行の先頭に置き、リセットボタンは
  // その後ろにだけ追加することで、＋/－の位置は常に固定される。
  const zoomBtns = el('div', { class: 'segmented' }, [
    zoomButton('－', 1.5, fullTMin, fullTMax, rerender),
    zoomButton('＋', 1 / 1.5, fullTMin, fullTMax, rerender),
  ]);
  const zoomToolbar = el('div', { class: 'toolbar', style: 'margin-top:-4px' }, [zoomBtns]);
  if (zoomRange) {
    const resetBtn = el('button', {}, ['ズームリセット']) as HTMLButtonElement;
    resetBtn.addEventListener('click', () => {
      zoomRange = null;
      rerender();
    });
    zoomToolbar.append(resetBtn);
  }
  area.appendChild(zoomToolbar);

  if (selectedCols.length === 0) {
    area.appendChild(el('div', { class: 'sub' }, ['左の一覧から表示する項目を選んでください。']));
    return area;
  }

  const legend = el('div', { style: 'display:flex;gap:14px;flex-wrap:wrap;margin-bottom:6px;font-size:11.5px' });
  for (const col of selectedCols) {
    legend.appendChild(
      el('span', {}, [
        el('span', {
          style: `display:inline-block;width:12px;height:3px;background:${colorForItem.get(col.id)};margin-right:5px;vertical-align:2px`,
        }),
        `${col.name}${unitSuffix(col.unit)}`,
      ])
    );
  }
  area.appendChild(legend);

  // ズーム範囲が指定されていれば、その時間範囲内の行だけを描画対象にする。
  // ウィンドウ内にたまたま1点もない(実データの間隔がズーム幅より広い)場合は、
  // 空表示にせず直前・直後の点を補って線がつながるようにする
  // (「ズーム範囲内にデータがありません」を極力出さないようにするため)。
  let visibleRows = zoomRange ? rows.filter((r) => r.t >= zoomRange!.tMin && r.t <= zoomRange!.tMax) : rows;
  if (visibleRows.length === 0 && zoomRange) {
    const before = [...rows].reverse().find((r) => r.t < zoomRange!.tMin);
    const after = rows.find((r) => r.t > zoomRange!.tMax);
    visibleRows = [before, after].filter((r): r is ChartRow => !!r);
  }
  if (visibleRows.length === 0) {
    area.appendChild(el('div', { class: 'sub' }, ['表示できるデータがありません。']));
    return area;
  }

  // 折れ線の描画だけ、必要なら間引く(ホバーのツールチップは間引き前のvisibleRows
  // を使い、最も近い時刻の値を正確に拾えるようにする)。
  const renderRows = downsampleRows(visibleRows, ROW_LIMIT);
  const { svg, tMin, tMax } = buildSvg(renderRows, selectedCols, colorForItem, mode);
  const svgHost = el('div', { style: 'position:relative' });
  svgHost.innerHTML = svg;
  area.appendChild(svgHost);

  const svgEl = svgHost.querySelector('svg');
  if (svgEl) {
    attachHoverTooltip(svgHost, svgEl, visibleRows, selectedCols, colorForItem, tMin, tMax);
    attachWheelPan(svgEl, fullTMin, fullTMax, rerender);
  }

  return area;
}

/** ＋－ボタン: 現在の表示範囲の中心を軸にズームする。 */
function zoomButton(
  label: string,
  factor: number,
  fullTMin: number,
  fullTMax: number,
  rerender: () => void
): HTMLButtonElement {
  const btn = el('button', { title: label === '＋' ? 'ズームイン' : 'ズームアウト' }, [label]) as HTMLButtonElement;
  btn.addEventListener('click', () => {
    const fullSpan = fullTMax - fullTMin || 1;
    const curTMin = zoomRange ? zoomRange.tMin : fullTMin;
    const curTMax = zoomRange ? zoomRange.tMax : fullTMax;
    const curSpan = curTMax - curTMin;
    const center = (curTMin + curTMax) / 2;
    let newSpan = Math.min(fullSpan, Math.max(fullSpan * 0.005, curSpan * factor));
    let newTMin = center - newSpan / 2;
    let newTMax = center + newSpan / 2;
    if (newTMin < fullTMin) {
      newTMin = fullTMin;
      newTMax = newTMin + newSpan;
    }
    if (newTMax > fullTMax) {
      newTMax = fullTMax;
      newTMin = newTMax - newSpan;
    }
    zoomRange = newSpan >= fullSpan - 1e-9 ? null : { tMin: newTMin, tMax: newTMax };
    rerender();
  });
  return btn;
}

/**
 * ホイールでカーソル位置を中心に時間範囲をズームする。preserveAspectRatio
 * ="none"にしているため、マウス座標→SVGユーザー座標の変換は単純な線形
 * スケールでよい(attachHoverTooltipと同じ考え方)。
 */
/** ホイールは左右移動(パン)専用。全体表示中(ズームなし)は何もしない。 */
function attachWheelPan(svgEl: SVGElement, fullTMin: number, fullTMax: number, rerender: () => void): void {
  svgEl.addEventListener(
    'wheel',
    (ev) => {
      const fullSpan = fullTMax - fullTMin || 1;
      const curTMin = zoomRange ? zoomRange.tMin : fullTMin;
      const curTMax = zoomRange ? zoomRange.tMax : fullTMax;
      const curSpan = curTMax - curTMin;
      if (curSpan >= fullSpan - 1e-9) return; // 全体表示中は移動先が無い

      ev.preventDefault();
      const wheelEv = ev as WheelEvent;
      // 横方向ホイール(Shift+ホイールやトラックパッド)があればdeltaXを優先する
      const delta = Math.abs(wheelEv.deltaX) > Math.abs(wheelEv.deltaY) ? wheelEv.deltaX : wheelEv.deltaY;
      const shift = (delta > 0 ? 1 : -1) * curSpan * 0.2;

      let newTMin = curTMin + shift;
      let newTMax = curTMax + shift;
      if (newTMin < fullTMin) {
        newTMin = fullTMin;
        newTMax = newTMin + curSpan;
      }
      if (newTMax > fullTMax) {
        newTMax = fullTMax;
        newTMin = newTMax - curSpan;
      }
      zoomRange = { tMin: newTMin, tMax: newTMax };
      rerender();
    },
    { passive: false }
  );
}

function buildSvg(
  rows: ChartRow[],
  cols: ChartColumn[],
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
    rows.map((r) => r.values.get(c.id)).filter((d): d is DecodedValue => !!d && d.clamp !== 'nc')
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
    const color = colorForItem.get(col.id)!;
    let segment: string[] = [];
    const segments: string[][] = [];
    for (const row of rows) {
      const d = row.values.get(col.id);
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

    // MAX/MINマーカーは「到達した瞬間」と「脱した瞬間」の遷移点だけに表示する
    // (張り付いたまま続く区間の全点に出すと▲▼だらけになり線が見えなくなるため)。
    let prevClamp: ClampState | undefined;
    for (const row of rows) {
      const d = row.values.get(col.id);
      if (!d || d.clamp === 'nc') continue;
      const cur = d.clamp;
      const enteredOrLeftMax = (cur === 'max') !== (prevClamp === 'max');
      const enteredOrLeftMin = (cur === 'min') !== (prevClamp === 'min');
      if (enteredOrLeftMax || enteredOrLeftMin) {
        const x = xOf(row.t);
        const y = yOf(d.value, i);
        // 遷移が「MAXに関するもの」か「MINに関するもの」かを優先判定する
        // (通常MAX/MIN間を直接またぐことはないため、片方だけ真になる想定)。
        body += enteredOrLeftMax
          ? `<polygon points="${x - 4},${y + 6} ${x + 4},${y + 6} ${x},${y - 2}" fill="${CLAMP_MAX_COLOR}"/>`
          : `<polygon points="${x - 4},${y - 6} ${x + 4},${y - 6} ${x},${y + 2}" fill="${CLAMP_MIN_COLOR}"/>`;
      }
      prevClamp = cur;
    }
  });

  body += `<text x="${MARGIN.left}" y="${VB_H - 8}" font-size="10" fill="#9a9a9a" font-family="ui-monospace,monospace">${fmtTime(tMin)}</text>`;
  body += `<text x="${VB_W - MARGIN.right}" y="${VB_H - 8}" font-size="10" fill="#9a9a9a" text-anchor="end" font-family="ui-monospace,monospace">${fmtTime(tMax)}</text>`;

  // preserveAspectRatio="none": 既定の"xMidYMid meet"だと表示ボックスと
  // viewBoxの縦横比が違う場合にレターボックス(余白)が入り、マウス座標から
  // SVGユーザー座標への単純な線形変換(attachHoverTooltip)が
  // ズレる原因になっていたため、縦横独立にフィットさせて単純な線形変換で
  // 正しく対応づくようにする。
  const svg = `<svg viewBox="0 0 ${VB_W} ${VB_H}" width="100%" height="340" preserveAspectRatio="none" style="display:block;cursor:crosshair">${body}</svg>`;
  return { svg, tMin, tMax };
}

function attachHoverTooltip(
  hostEl: HTMLElement,
  svgEl: SVGElement,
  rows: ChartRow[],
  cols: ChartColumn[],
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
      const d = nearest.values.get(col.id);
      tooltip.appendChild(
        el('div', {}, [
          el('span', {
            style: `display:inline-block;width:8px;height:8px;background:${colorForItem.get(col.id)};margin-right:5px;border-radius:2px`,
          }),
          `${col.name}: ${d ? (d.clamp === 'nc' ? 'N.C.' : `${fmtNum(d.value)}${unitSuffix(col.unit)}`) : '—'}`,
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
