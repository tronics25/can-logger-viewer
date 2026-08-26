// Webview UI: 時系列グラフへの外部CSV取り込み。
// 「別のデータソース(他のログ・実測値・シミュレーション結果等)のCSVを、
// 同じ時間軸のLogger/固定フォーマット信号と重ねて比較したい」というニーズに
// 応える。取り込んだ列は既存のChartColumn/ChartRowとまったく同じ形で扱う
// ため、時系列グラフのピッカー・凡例・色選択・ホバー等はLogger項目や
// 固定フォーマット信号と完全に共用できる。
import { ClampState, DecodedValue } from '../models/types';
import { el, icon, vscodeApi } from './common';
import { ChartColumn, ChartRow } from './loggerRows';

const api = vscodeApi();

/** RFC4180ライクな簡易CSVパーサ (ダブルクォート囲み・""エスケープ・CRLF対応)。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // 次の\nで改行確定するため無視
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/**
 * 2つのChartRow[]を時系列でマージする。それぞれ既に前方補完済みの
 * スナップショット列である前提で、時刻の和集合上で両者の直近値を
 * 突き合わせるだけで、結合後も正しく前方補完された状態になる。
 */
export function mergeChartRows(a: ChartRow[], b: ChartRow[]): ChartRow[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const times = Array.from(new Set([...a.map((r) => r.t), ...b.map((r) => r.t)])).sort((x, y) => x - y);
  const merged: ChartRow[] = [];
  let ai = -1;
  let bi = -1;
  for (const t of times) {
    while (ai + 1 < a.length && a[ai + 1].t <= t) ai++;
    while (bi + 1 < b.length && b[bi + 1].t <= t) bi++;
    const values = new Map<string, DecodedValue>();
    if (ai >= 0) for (const [k, v] of a[ai].values) values.set(k, v);
    if (bi >= 0) for (const [k, v] of b[bi].values) values.set(k, v);
    merged.push({ t, values });
  }
  return merged;
}

interface PendingImport {
  fileName: string;
  headers: string[];
  rows: string[][];
  timestampColIndex: number | null;
  selectedColIndices: Set<number>;
  /** 列ごとの単位(任意入力・空なら未設定のまま=凡例には表示されない)。 */
  units: Map<number, string>;
}

interface CsvSource {
  id: string;
  fileName: string;
  columns: ChartColumn[];
  rows: ChartRow[];
}

let pendingImport: PendingImport | null = null;
const importedSources: CsvSource[] = [];
let onLoadedCallback: (() => void) | null = null;

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'csvFileLoaded') {
    const table = parseCsv(msg.content as string);
    if (table.length === 0) return;
    pendingImport = {
      fileName: msg.fileName,
      headers: table[0],
      rows: table.slice(1),
      timestampColIndex: null,
      selectedColIndices: new Set(),
      units: new Map(),
    };
    onLoadedCallback?.();
  }
});

/** 時系列グラフのピッカーに渡す、CSV取り込み済みの列・行データ (毎回マージして使う)。 */
export function getImportedChartData(): { columns: ChartColumn[]; rows: ChartRow[] } {
  const columns = importedSources.flatMap((s) => s.columns);
  let rows: ChartRow[] = [];
  for (const s of importedSources) rows = mergeChartRows(rows, s.rows);
  return { columns, rows };
}

function csvColumnId(sourceId: string, colIndex: number): string {
  return `csv:${sourceId}:${colIndex}`;
}

function commitImport(): void {
  if (!pendingImport) return;
  const p = pendingImport;
  if (p.timestampColIndex === null || p.selectedColIndices.size === 0) return;
  const sourceId = `csvsrc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const columns: ChartColumn[] = [];
  for (const idx of p.selectedColIndices) {
    const unit = (p.units.get(idx) ?? '').trim();
    columns.push({ id: csvColumnId(sourceId, idx), name: p.headers[idx] || `列${idx + 1}`, unit, groupLabel: `CSV: ${p.fileName}` });
  }
  const rows: ChartRow[] = [];
  for (const r of p.rows) {
    const t = parseFloat(r[p.timestampColIndex]);
    if (Number.isNaN(t)) continue;
    const values = new Map<string, DecodedValue>();
    for (const idx of p.selectedColIndices) {
      const raw = parseFloat(r[idx]);
      const clamp: ClampState = Number.isNaN(raw) ? 'nc' : null;
      const unit = (p.units.get(idx) ?? '').trim();
      values.set(csvColumnId(sourceId, idx), { raw, value: raw, unit, clamp });
    }
    rows.push({ t, values });
  }
  rows.sort((a, b) => a.t - b.t);
  importedSources.push({ id: sourceId, fileName: p.fileName, columns, rows });
  pendingImport = null;
}

function removeSource(sourceId: string): void {
  const idx = importedSources.findIndex((s) => s.id === sourceId);
  if (idx >= 0) importedSources.splice(idx, 1);
}

/** ピッカー先頭に置く、CSV取り込みボタン・進行中ウィザード・取り込み済み一覧。 */
export function buildCsvImportSection(rerender: () => void): HTMLElement {
  const wrap = el('div', { style: 'margin-bottom:8px' });

  const importBtn = el('button', {}, ['+ CSVを読み込む']) as HTMLButtonElement;
  importBtn.addEventListener('click', () => {
    onLoadedCallback = rerender;
    api.postMessage({ type: 'importCsv' });
  });
  wrap.appendChild(importBtn);

  if (importedSources.length > 0) {
    const list = el('div', { style: 'margin-top:6px' });
    for (const s of importedSources) {
      const row = el('div', {
        style: 'display:flex;align-items:center;gap:5px;font-size:11px;padding:2px 0;color:var(--vscode-descriptionForeground)',
      });
      const delBtn = el('button', { class: 'icon-btn', title: '取り込みを解除' }, [icon('trash', '12px')]) as HTMLButtonElement;
      delBtn.addEventListener('click', () => {
        removeSource(s.id);
        rerender();
      });
      row.append(el('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, [s.fileName]), delBtn);
      list.appendChild(row);
    }
    wrap.appendChild(list);
  }

  if (pendingImport) wrap.appendChild(buildImportWizard(rerender));

  return wrap;
}

function buildImportWizard(rerender: () => void): HTMLElement {
  const p = pendingImport!;
  const box = el('div', {
    style:
      'border:1px solid var(--vscode-panel-border);border-radius:4px;padding:8px;margin-top:6px;' +
      'background:var(--vscode-sideBar-background);font-size:12px;',
  });
  box.appendChild(el('div', { style: 'font-weight:600;margin-bottom:6px;word-break:break-all' }, [p.fileName]));

  box.appendChild(el('div', { class: 'sub', style: 'margin:0 0 3px' }, ['タイムスタンプ列（秒、グラフと同じ基準）:']));
  const tsSelect = el('select', { style: 'width:100%' }) as HTMLSelectElement;
  tsSelect.appendChild(el('option', { value: '' }, ['（選択してください）']) as HTMLOptionElement);
  p.headers.forEach((h, i) => {
    const opt = el('option', { value: String(i) }, [h || `列${i + 1}`]) as HTMLOptionElement;
    if (p.timestampColIndex === i) opt.selected = true;
    tsSelect.appendChild(opt);
  });
  tsSelect.addEventListener('change', () => {
    p.timestampColIndex = tsSelect.value === '' ? null : parseInt(tsSelect.value, 10);
    rerender();
  });
  box.appendChild(tsSelect);

  box.appendChild(el('div', { class: 'sub', style: 'margin:8px 0 3px' }, ['取り込む列（単位は任意・わからなければ空欄でOK）:']));
  const colList = el('div', { style: 'max-height:160px;overflow-y:auto' });
  p.headers.forEach((h, i) => {
    if (i === p.timestampColIndex) return;
    const row = el('div', { style: 'display:flex;align-items:center;gap:6px;padding:2px 0' });
    const label = el('label', { style: 'display:flex;align-items:center;gap:6px;flex:1;min-width:0;cursor:pointer' });
    const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
    cb.checked = p.selectedColIndices.has(i);
    cb.addEventListener('change', () => {
      if (cb.checked) p.selectedColIndices.add(i);
      else p.selectedColIndices.delete(i);
      rerender(); // 「グラフに追加」ボタンのdisabled判定を更新するため再描画する
    });
    label.append(cb, el('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, [h || `列${i + 1}`]));
    const unitInput = el('input', {
      type: 'text',
      placeholder: '単位(任意)',
      style: 'width:64px;flex-shrink:0',
    }) as HTMLInputElement;
    unitInput.value = p.units.get(i) ?? '';
    unitInput.addEventListener('change', () => {
      p.units.set(i, unitInput.value);
    });
    row.append(label, unitInput);
    colList.appendChild(row);
  });
  box.appendChild(colList);

  const btnRow = el('div', { style: 'display:flex;gap:6px;margin-top:8px' });
  const addBtn = el('button', { class: 'primary' }, ['グラフに追加']) as HTMLButtonElement;
  addBtn.disabled = p.timestampColIndex === null || p.selectedColIndices.size === 0;
  addBtn.addEventListener('click', () => {
    commitImport();
    rerender();
  });
  const cancelBtn = el('button', {}, ['キャンセル']) as HTMLButtonElement;
  cancelBtn.addEventListener('click', () => {
    pendingImport = null;
    rerender();
  });
  btnRow.append(addBtn, cancelBtn);
  box.appendChild(btnRow);

  return box;
}
