// Webview UI: ログビューア本体 (「生ログ」タブ + 「Logger」タブ)
import { formatCanId } from '../decode/canId';
import { decodeFixedFormatFrame } from '../decode/fixedFormatDecode';
import {
  CanIdRef,
  ClampState,
  DecodedValue,
  FixedFormatCanIdEntry,
  LoggerCanIdsFile,
  LoggerMappingProfile,
  LoggerMappingsFile,
  LoggerSpecsFile,
} from '../models/types';
import { clear, el, injectBaseStyles, vscodeApi } from './common';
import { LoggerColumn, LoggerRow, WireFrame, buildLoggerRows, loggerColumnsFor } from './loggerRows';
import { renderTimeSeriesTab } from './timeSeriesChart';
import { renderThreeDTab, stopThreeDPlayback } from './threeDChart';
import { measureMaxCellWidth, renderVirtualTable } from './virtualList';

const api = vscodeApi();

let fileName = '';
let frames: WireFrame[] = [];
let warnings: string[] = [];
let fixedFormat: FixedFormatCanIdEntry[] = [];
let loggerSpecs: LoggerSpecsFile = { categories: [], items: [] };
let loggerCanIds: LoggerCanIdsFile = { assignments: [] };
let loggerMappings: LoggerMappingsFile = { profiles: [] };

let activeTab: 'raw' | 'logger' = 'raw';
let activeLoggerSubTab: 'table' | 'timeseries' | '3d' = 'table';
let rawFilterPattern = '';
let selectedProfileId: string | null = null;

function root(): HTMLElement {
  return document.getElementById('root')!;
}

// ---------------------------------------------------------------------------
// 生ログタブ
// ---------------------------------------------------------------------------

function canIdRef(f: WireFrame): CanIdRef {
  return { id: f.canId, extended: f.extended };
}

function matchesFilter(f: WireFrame): boolean {
  if (!rawFilterPattern) return true;
  try {
    const re = new RegExp(rawFilterPattern, 'i');
    return re.test(formatCanId(canIdRef(f)));
  } catch {
    return true;
  }
}

function findFixedFormatEntry(f: WireFrame): FixedFormatCanIdEntry | undefined {
  return fixedFormat.find((e) => e.canId.id === f.canId && e.canId.extended === f.extended);
}

function buildContentCell(f: WireFrame): HTMLElement {
  const entry = findFixedFormatEntry(f);
  if (!entry) {
    const hex = Array.from(f.data.slice(0, f.dlc))
      .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
      .join(' ');
    const span = el('span', { class: 'mono', style: 'color:var(--vscode-descriptionForeground)' }, [
      hex || '(0バイト)',
    ]);
    span.title = hex; // 列幅で見切れた場合もホバーで全体を確認できるようにする
    return span;
  }
  const data = new Uint8Array(f.data);
  const { decoded, skipped } = decodeFixedFormatFrame(entry.signals, data);
  const wrap = el('span', {});
  const plainParts: string[] = [];
  for (const { signal, decoded: d } of decoded) {
    wrap.appendChild(
      el('span', { class: 'sig-tok' }, [`${signal.name} `, el('b', {}, [formatNumber(d.value)]), ` ${signal.unit}`])
    );
    plainParts.push(`${signal.name} ${formatNumber(d.value)} ${signal.unit}`);
  }
  if (decoded.length === 0 && skipped.length === 0) wrap.appendChild(el('span', { class: 'sub' }, ['(信号未登録)']));
  if (skipped.length > 0) {
    // 信号定義はあるが、このフレームの実データ長 (f.dlc) が信号の要求バイト
    // 範囲に届かない (例: 同じCAN IDでClassic CANとCAN FDが混在している場合)
    const note = `(${skipped.length}件は受信データ長${f.dlc}バイト不足のため非表示)`;
    wrap.appendChild(el('span', { class: 'sub', style: 'margin:0' }, [note]));
    plainParts.push(note);
  }
  wrap.title = plainParts.join('　'); // 列幅で見切れた場合もホバーで全体を確認できるようにする
  return wrap;
}

/**
 * 「生ログ」タブのCONTENT列幅。CAN IDごとに1件だけ代表フレームを実際に
 * デコード/計測し、その中で最大のものに合わせる (全件を毎回計測すると
 * フィルタ入力のたびに重くなるため、CAN ID種別数だけで済むようにする)。
 * frames/fixedFormatが変わるたびにrecomputeRawContentWidth()で更新する。
 */
let rawContentColumnWidth = 320;

function recomputeRawContentWidth(): void {
  const representative = new Map<string, WireFrame>();
  for (const f of frames) {
    const key = `${f.canId}:${f.extended}`;
    const cur = representative.get(key);
    // 同じCAN IDの中で最もバイト数が多いフレームを代表として使う
    // (未登録CAN IDの16進ダンプ幅はdlcに比例するため)
    if (!cur || f.dlc > cur.dlc) representative.set(key, f);
  }
  const candidates = Array.from(representative.values()).map((f) => buildContentCell(f));
  rawContentColumnWidth = measureMaxCellWidth(candidates, 320);
}

function formatNumber(v: number): string {
  if (Number.isNaN(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function renderRawTab(container: HTMLElement): void {
  const filterInput = el('input', {
    type: 'text',
    class: 'mono',
    value: rawFilterPattern,
    placeholder: 'CAN IDフィルタ（正規表現）例: ^18[0-9A-F]$',
    style: 'max-width:360px',
  }) as HTMLInputElement;
  filterInput.addEventListener('input', () => {
    rawFilterPattern = filterInput.value;
    renderRawTab(container);
  });

  const filtered = frames.filter(matchesFilter);
  const badge = el('span', { class: 'tag' }, [`${filtered.length} / ${frames.length} 件`]);

  const toolbar = el('div', { class: 'toolbar', style: 'flex:0 0 auto' }, [
    filterInput,
    badge,
    el('div', { class: 'spacer' }),
    button('CSVエクスポート', () => exportRawCsv(filtered), true),
  ]);

  const legend = el('div', { class: 'sub', style: 'flex:0 0 auto' }, [
    '信号名 値 単位 = 固定フォーマットフレーム登録済み（パース済み表示）　/　16進バイト列 = 未登録・またはLogger（Loggerタブで確認）　/　DLC = ログ上のDLCコード値(16進、Classic CANは実バイト数と同じ)　/　Length = 実データ長(バイト)',
  ]);

  clear(container);
  container.append(toolbar, legend);

  if (warnings.length) {
    for (const w of warnings) container.appendChild(el('div', { class: 'warn', style: 'flex:0 0 auto' }, [w]));
  }

  const tableHost = el('div', { style: 'flex:1;min-height:0;margin-top:2px;' });
  container.appendChild(tableHost);

  // 仮想スクロール: フィルタ後の全件を対象に、画面に見えている行だけを描画する
  // (数万行規模のログでも先頭だけに切り詰めず全件スクロール可能)。
  renderVirtualTable(tableHost, {
    columns: [
      { label: 'Time (s)', width: '90px' },
      { label: 'TX/RX', width: '56px' },
      { label: 'CAN ID', width: '110px' },
      { label: 'Ch', width: '48px' },
      { label: 'DLC', width: '48px' },
      { label: 'Length', width: '64px' },
      { label: 'CONTENT', width: `${rawContentColumnWidth}px` },
    ],
    rowCount: filtered.length,
    emptyMessage: '該当するフレームがありません。',
    renderRow: (i) => {
      const f = filtered[i];
      return [
        el('span', { class: 'mono' }, [f.t.toFixed(4)]),
        f.dir,
        el('span', { class: 'mono' }, [formatCanId(canIdRef(f))]),
        el('span', { class: 'mono' }, [String(f.channel)]),
        el('span', { class: 'mono' }, [f.dlcCode.toString(16).toUpperCase()]),
        el('span', { class: 'mono' }, [String(f.dlc)]),
        buildContentCell(f),
      ];
    },
  });
}

function exportRawCsv(rows: WireFrame[]): void {
  const lines = ['Time,TX/RX,CAN ID,CONTENT'];
  for (const f of rows) {
    const entry = findFixedFormatEntry(f);
    let content: string;
    if (entry) {
      const { decoded } = decodeFixedFormatFrame(entry.signals, new Uint8Array(f.data));
      content = decoded.map(({ signal, decoded: d }) => `${signal.name}=${formatNumber(d.value)}${signal.unit}`).join(' ');
    } else {
      content = Array.from(f.data.slice(0, f.dlc))
        .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
        .join(' ');
    }
    lines.push([f.t.toFixed(4), f.dir, formatCanId(canIdRef(f)), csvEscape(content)].join(','));
  }
  api.postMessage({ type: 'exportCsv', csv: lines.join('\n'), suggestedName: `${fileName}.raw.csv` });
}

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------------------
// Loggerタブ
// ---------------------------------------------------------------------------

function clampCell(d: DecodedValue): HTMLElement {
  if (d.clamp === 'nc') return el('span', { class: 'nc-cell' }, ['N.C.']);
  if (d.clamp === 'max') return el('span', { class: 'clamp-max' }, [formatNumber(d.value)]);
  if (d.clamp === 'min') return el('span', { class: 'clamp-min' }, [formatNumber(d.value)]);
  return el('span', {}, [formatNumber(d.value)]);
}

function renderLoggerTab(container: HTMLElement): void {
  clear(container);

  const profileSelect = el('select', { style: 'max-width:220px' }) as HTMLSelectElement;
  for (const p of loggerMappings.profiles) {
    const opt = el('option', { value: p.id }, [p.name]) as HTMLOptionElement;
    if (p.id === selectedProfileId) opt.selected = true;
    profileSelect.appendChild(opt);
  }
  profileSelect.addEventListener('change', () => {
    selectedProfileId = profileSelect.value;
    renderLoggerTab(container);
  });

  const subtabs = el('div', { class: 'toolbar' }, [
    el('div', { class: 'segmented' }, [
      subtabButton('テーブル', 'table'),
      subtabButton('時系列グラフ', 'timeseries'),
      subtabButton('3Dグラフ', '3d'),
    ]),
  ]);

  container.append(
    el('div', { class: 'toolbar' }, [el('span', {}, ['プロファイル:']), profileSelect]),
    subtabs
  );

  const profile = loggerMappings.profiles.find((p) => p.id === selectedProfileId);
  if (!profile) {
    container.appendChild(el('div', { class: 'sub' }, ['マッピングプロファイルがありません。サイドバーから作成してください。']));
    return;
  }

  if (activeLoggerSubTab !== '3d') stopThreeDPlayback();

  // テーブル/時系列/3Dの各描画関数は自分の担当領域だけをclearするため、
  // 上のプロファイル選択・サブタブボタンとは別の子要素に描画する
  // (以前はcontainer全体をclearしてしまい、サブタブボタンごと消えて
  // グラフ表示後に他のタブへ戻れなくなるバグがあった)。
  // flex:1で残り高さいっぱいに広げ、テーブル表示時は内部の仮想スクロール
  // 領域だけがスクロールするようにする。
  const subContent = el('div', {
    style: 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto;',
  });
  container.appendChild(subContent);

  if (activeLoggerSubTab === 'table') {
    renderLoggerTable(subContent, profile);
  } else if (activeLoggerSubTab === 'timeseries') {
    const columns = loggerColumnsFor(profile, loggerSpecs);
    const rows = buildLoggerRows(profile, frames, loggerSpecs, loggerCanIds);
    renderTimeSeriesTab(subContent, rows, columns, loggerSpecs.categories);
  } else {
    const columns = loggerColumnsFor(profile, loggerSpecs);
    const rows = buildLoggerRows(profile, frames, loggerSpecs, loggerCanIds);
    renderThreeDTab(subContent, rows, columns);
  }

  function subtabButton(label: string, id: typeof activeLoggerSubTab): HTMLButtonElement {
    const b = el('button', { class: activeLoggerSubTab === id ? 'primary' : '' }, [label]) as HTMLButtonElement;
    b.addEventListener('click', () => {
      activeLoggerSubTab = id;
      renderLoggerTab(container);
    });
    return b;
  }
}

function renderLoggerTable(container: HTMLElement, profile: LoggerMappingProfile): void {
  const columns = loggerColumnsFor(profile, loggerSpecs);
  const rows = buildLoggerRows(profile, frames, loggerSpecs, loggerCanIds);

  container.appendChild(
    el('div', { class: 'toolbar', style: 'flex:0 0 auto' }, [
      el('span', { class: 'tag' }, [`${rows.length} 件`]),
      el('div', { class: 'spacer' }),
      button('CSVエクスポート', () => exportLoggerCsv(columns, rows), true),
    ])
  );
  container.appendChild(
    el('div', { class: 'sub', style: 'flex:0 0 auto' }, [
      'オレンジ=MAX到達　紫=MIN到達　グレー=未設定(N.C.)　— 各行はそのフレーム到着時点までに判明している最新値です（他のLogger番号の項目は直近の値を保持表示）。',
    ])
  );

  const tableHost = el('div', { style: 'flex:1;min-height:0;margin-top:2px;' });
  container.appendChild(tableHost);

  renderVirtualTable(tableHost, {
    columns: [
      { label: 'Time (s)', width: '90px' },
      { label: 'Logger', width: '64px' },
      ...columns.map((c) => ({ label: `${c.item.name} (${c.item.unit})`, width: '150px' })),
    ],
    rowCount: rows.length,
    emptyMessage: 'このプロファイルで受信したデータがまだありません。',
    renderRow: (i) => {
      const row = rows[i];
      const cells: (Node | string)[] = [el('span', { class: 'mono' }, [row.t.toFixed(4)]), String(row.loggerNumber)];
      for (const col of columns) {
        const d = row.values.get(col.item.id);
        cells.push(d ? clampCell(d) : el('span', { class: 'sub' }, ['—']));
      }
      return cells;
    },
  });
}

function exportLoggerCsv(columns: LoggerColumn[], rows: LoggerRow[]): void {
  const header = ['Time', 'Logger', ...columns.flatMap((c) => [c.item.name, `${c.item.name}_state`])];
  const lines = [header.join(',')];
  for (const row of rows) {
    const cells = [row.t.toFixed(4), String(row.loggerNumber)];
    for (const col of columns) {
      const d = row.values.get(col.item.id);
      cells.push(d ? formatNumber(d.value) : '');
      cells.push(d ? clampLabel(d.clamp) : '');
    }
    lines.push(cells.join(','));
  }
  api.postMessage({ type: 'exportCsv', csv: lines.join('\n'), suggestedName: `${fileName}.logger.csv` });
}

function clampLabel(c: ClampState): string {
  if (c === 'max') return 'MAX';
  if (c === 'min') return 'MIN';
  if (c === 'nc') return 'N.C.';
  return '';
}

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = el('button', { class: primary ? 'primary' : '' }, [label]) as HTMLButtonElement;
  b.addEventListener('click', onClick);
  return b;
}

function render(): void {
  const r = root();
  clear(r);

  // 生ログ/Loggerテーブルの仮想スクロールが機能するよう、ページ全体を
  // 画面の高さいっぱいに固定したflex縦積みレイアウトにする
  // (bodyのpaddingはBASE_CSS由来なので、rootの方にpaddingを付け替える)。
  document.body.style.padding = '0';
  document.body.style.height = '100vh';
  document.body.style.overflow = 'hidden';
  r.style.display = 'flex';
  r.style.flexDirection = 'column';
  r.style.height = '100%';
  r.style.boxSizing = 'border-box';
  r.style.padding = '14px 18px';

  r.append(el('h1', { style: 'flex:0 0 auto' }, [fileName]));

  const tabs = el('div', { class: 'toolbar', style: 'flex:0 0 auto' }, [
    el('div', { class: 'segmented' }, [tabButton('生ログ', 'raw'), tabButton('Logger', 'logger')]),
  ]);
  r.appendChild(tabs);

  const content = el('div', {
    style: 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;',
  });
  r.appendChild(content);
  if (activeTab === 'raw') {
    stopThreeDPlayback();
    renderRawTab(content);
  } else {
    renderLoggerTab(content);
  }

  function tabButton(label: string, id: typeof activeTab): HTMLButtonElement {
    const b = el('button', { class: activeTab === id ? 'primary' : '' }, [label]) as HTMLButtonElement;
    b.addEventListener('click', () => {
      activeTab = id;
      render();
    });
    return b;
  }
}

injectBaseStyles();
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    fileName = msg.fileName;
    frames = msg.frames;
    warnings = msg.warnings;
    fixedFormat = msg.fixedFormat;
    loggerSpecs = msg.loggerSpecs;
    loggerCanIds = msg.loggerCanIds;
    loggerMappings = msg.loggerMappings;
    selectedProfileId = loggerMappings.profiles[0]?.id ?? null;
    recomputeRawContentWidth();
    render();
  } else if (msg.type === 'registriesUpdated') {
    fixedFormat = msg.fixedFormat;
    loggerSpecs = msg.loggerSpecs;
    loggerCanIds = msg.loggerCanIds;
    loggerMappings = msg.loggerMappings;
    recomputeRawContentWidth();
    render();
  }
});
api.postMessage({ type: 'ready' });
render();
