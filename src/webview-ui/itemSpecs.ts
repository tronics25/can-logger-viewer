// Webview UI: Logger項目仕様エディタ (分類ツリー + インライン編集テーブル)
import {
  LoggerCategory,
  LoggerDataLength,
  LoggerItemSpec,
  LoggerSpecsFile,
  dataNumberRangeLabel,
  loggerItemKeyLabel,
  loggerItemsOverlap,
  occupiedDataNumbers,
} from '../models/types';
import { clear, el, icon, injectBaseStyles, lsbInput, makeTableColumnsResizable, measureMaxCellWidth, vscodeApi } from './common';

const api = vscodeApi();
let state: LoggerSpecsFile = { categories: [], items: [] };

function uid(): string {
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 自分以外で、分類内のデータ番号が重なっている項目一覧。 */
function overlapsFor(item: LoggerItemSpec): LoggerItemSpec[] {
  return state.items.filter((other) => other.id !== item.id && loggerItemsOverlap(item, other));
}

function duplicateCategoryNumbers(): Set<number> {
  const counts = new Map<number, number>();
  for (const c of state.categories) counts.set(c.number, (counts.get(c.number) ?? 0) + 1);
  const dupes = new Set<number>();
  for (const [num, count] of counts) if (count > 1) dupes.add(num);
  return dupes;
}

function save(): void {
  api.postMessage({ type: 'save', data: state });
  render();
}

function root(): HTMLElement {
  return document.getElementById('root')!;
}

function render(): void {
  const r = root();
  clear(r);

  const toolbar = el('div', { class: 'toolbar' }, [
    button('+ 分類を追加', () => api.postMessage({ type: 'newCategory' }), true),
    el('div', { class: 'spacer' }),
    button('Auto Fit', () => {
      // 手動リサイズをすべて解除し、実データに合わせた自動計測幅に戻す。
      itemColWidths = null;
      render();
    }),
    button('JSONインポート', () => api.postMessage({ type: 'import' })),
    button('JSONエクスポート', () => api.postMessage({ type: 'export' })),
  ]);

  const header = el('div', {}, [
    el('h1', {}, ['Logger項目仕様']),
    el('div', { class: 'sub' }, [
      `${state.categories.length} 分類 / ${state.items.length} 項目 — .canlogger/logger-specs.json　`,
      '項目（データ番号）は各分類の「＋ この分類に項目を追加」から追加してください。',
    ]),
  ]);

  if (!itemColWidths) itemColWidths = measureItemColWidths(state.items);
  const colgroup = el(
    'colgroup',
    {},
    itemColWidths.map((w) => el('col', { style: `width:${w}px` }))
  );
  const table = el('table', { style: 'table-layout:fixed' }, [colgroup, buildThead(), buildTbody()]);
  makeTableColumnsResizable(table, itemColWidths);

  r.append(header, toolbar, table);
}

const ITEM_COL_LABELS = ['データ名称', 'データ番号', 'データ長', '単位', 'オフセット', 'Lsb', 'Max', 'Min', 'エンディアン', ''];

/**
 * 各列の実幅(px)。列境界のドラッグでこの配列を直接書き換えることで、
 * 再描画をまたいで手動リサイズを保持する。nullのままなら次のrender()で
 * 実データに合わせた自動計測幅を算出する(Auto Fitボタンでもnullに戻す)。
 */
let itemColWidths: number[] | null = null;

/** 項目テーブルの列幅を、ヘッダーラベルと実際の値の表示幅から自動計測する。 */
function measureItemColWidths(items: LoggerItemSpec[]): number[] {
  const col = (i: number, extra: (Node | string)[], fallback: number) =>
    measureMaxCellWidth([ITEM_COL_LABELS[i], ...extra], fallback);
  return [
    col(0, items.map((i) => i.name), 140),
    130, // データ番号(分類セレクト+ダッシュ+データ番号入力の複合セル)
    170, // データ長(セレクト+UINT32時の"→ 4~5"バッジの複合セル)
    col(3, items.map((i) => i.unit), 70),
    col(4, items.map((i) => String(i.offset)), 90),
    col(5, items.map((i) => i.lsbText ?? i.lsb.toString()), 100),
    col(6, items.map((i) => String(i.max)), 90),
    col(7, items.map((i) => String(i.min)), 90),
    100, // エンディアン(セレクト)
    36, // 削除ボタン
  ];
}

function buildThead(): HTMLElement {
  return el('thead', {}, [el('tr', {}, ITEM_COL_LABELS.map((t) => el('th', {}, [t])))]);
}

function buildTbody(): HTMLElement {
  const tbody = el('tbody');
  const dupeCategories = duplicateCategoryNumbers();
  const sortedCategories = [...state.categories].sort((a, b) => a.number - b.number);

  for (const category of sortedCategories) {
    tbody.appendChild(buildGroupRow(category));
    if (dupeCategories.has(category.number)) {
      tbody.appendChild(
        el('tr', {}, [
          el('td', { colspan: '10' }, [el('div', { class: 'warn' }, [`分類番号 ${category.number} が他の分類と重複しています。`])]),
        ])
      );
    }
    const items = state.items
      .filter((i) => i.categoryNumber === category.number)
      .sort((a, b) => a.dataNumber - b.dataNumber);
    for (const item of items) {
      const overlaps = overlapsFor(item);
      tbody.appendChild(buildItemRow(item, overlaps.length > 0));
      if (overlaps.length > 0) {
        const names = overlaps.map((o) => `「${o.name}」(${dataNumberRangeLabel(o)})`).join('、');
        tbody.appendChild(
          el('tr', {}, [
            el('td', { colspan: '10' }, [
              el('div', { class: 'warn' }, [`データ番号 (${loggerItemKeyLabel(item)}) が ${names} と重複しています。`]),
            ]),
          ])
        );
      }
    }
  }

  // 分類が削除された等で分類未登録になった項目 (通常のUI操作では発生しない防御的表示)
  const uncategorized = state.items.filter((i) => !state.categories.some((c) => c.number === i.categoryNumber));
  if (uncategorized.length > 0) {
    tbody.appendChild(
      el('tr', {}, [
        el('td', { colspan: '10' }, [
          el('div', { class: 'warn' }, ['未登録の分類を参照している項目があります。下の行で分類を選び直してください。']),
        ]),
      ])
    );
    for (const item of uncategorized) {
      tbody.appendChild(buildItemRow(item, overlapsFor(item).length > 0));
    }
  }

  return tbody;
}

function buildGroupRow(category: LoggerCategory): HTMLElement {
  const numberInputEl = el('input', {
    type: 'number',
    value: String(category.number),
    class: 'mono',
    style: 'max-width:80px;font-weight:600',
  }) as HTMLInputElement;
  numberInputEl.addEventListener('change', () => {
    const v = parseInt(numberInputEl.value, 10);
    if (!Number.isNaN(v)) category.number = v;
    save();
  });

  const nameInput = el('input', { type: 'text', value: category.name, style: 'font-weight:600;max-width:220px' }) as HTMLInputElement;
  nameInput.addEventListener('change', () => {
    // 前後の空白が付いたままだと気づきにくい形でグラフの見出し等に影響するため確定時に除く
    category.name = nameInput.value.trim();
    save();
  });
  const count = state.items.filter((i) => i.categoryNumber === category.number).length;

  const addBtn = button('+ この分類に項目を追加', () => addItem(category.number), true);
  const delBtn = button('削除', () => {
    state.categories = state.categories.filter((c) => c.number !== category.number);
    save();
  });
  if (count > 0) {
    delBtn.disabled = true;
    delBtn.title = 'この分類には項目が残っています。先に項目を削除または他の分類に移動してください。';
  }

  return el('tr', { class: 'group-row' }, [
    el('td', { colspan: '10' }, [
      el('div', { style: 'display:flex;align-items:center;gap:8px' }, [
        numberInputEl,
        nameInput,
        el('span', { class: 'sub', style: 'margin:0' }, [`${count}件`]),
        el('div', { class: 'spacer' }),
        addBtn,
        delBtn,
      ]),
    ]),
  ]);
}

function numberInput(value: number, onChange: (v: number) => void, width = ''): HTMLInputElement {
  const input = el('input', { type: 'number', value: String(value), class: 'mono', style: width }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v)) onChange(v);
    save();
  });
  return input;
}

function textInput(value: string, onChange: (v: string) => void, mono = false): HTMLInputElement {
  const input = el('input', { type: 'text', value, class: mono ? 'mono' : '' }) as HTMLInputElement;
  input.addEventListener('change', () => {
    // 前後の空白(半角・全角とも)が付いたままだと見た目には気づきにくいまま
    // Auto Fitの列幅計算に影響してしまうため、確定時に取り除く。
    onChange(input.value.trim());
    save();
  });
  return input;
}


function buildItemRow(item: LoggerItemSpec, isDupe: boolean): HTMLElement {
  const categorySelect = el('select', { class: 'mono', style: 'width:70px' }) as HTMLSelectElement;
  for (const c of state.categories) {
    const opt = el('option', { value: String(c.number) }, [`${c.number}`]) as HTMLOptionElement;
    if (c.number === item.categoryNumber) opt.selected = true;
    categorySelect.appendChild(opt);
  }
  categorySelect.addEventListener('change', () => {
    item.categoryNumber = parseInt(categorySelect.value, 10);
    save();
  });

  const dataNumberInput = el('input', {
    type: 'number',
    value: String(item.dataNumber),
    class: 'mono',
    style: 'width:64px',
    min: '1',
  }) as HTMLInputElement;
  dataNumberInput.addEventListener('change', () => {
    // データ番号0は「未設定スロット」を表す予約値のため、項目には割り当てない
    const v = parseInt(dataNumberInput.value, 10);
    if (!Number.isNaN(v) && v >= 1) item.dataNumber = v;
    else dataNumberInput.value = String(item.dataNumber);
    save();
  });

  const dataLengthSelect = el('select', { style: 'width:100px' }) as HTMLSelectElement;
  for (const value of ['UINT16', 'UINT32'] as LoggerDataLength[]) {
    const opt = el('option', { value }, [value]) as HTMLOptionElement;
    if (item.dataLength === value) opt.selected = true;
    dataLengthSelect.appendChild(opt);
  }
  dataLengthSelect.addEventListener('change', () => {
    item.dataLength = dataLengthSelect.value as LoggerDataLength;
    save();
  });

  const endianSelect = el('select', { style: 'width:80px' }) as HTMLSelectElement;
  for (const [value, label] of [['little', 'Little'], ['big', 'Big']] as const) {
    const opt = el('option', { value }, [label]) as HTMLOptionElement;
    if (item.endian === value) opt.selected = true;
    endianSelect.appendChild(opt);
  }
  endianSelect.addEventListener('change', () => {
    item.endian = endianSelect.value as 'little' | 'big';
    save();
  });

  const deleteBtn = el('button', { class: 'icon-btn', title: '削除' }, [icon('trash')]);
  deleteBtn.addEventListener('click', () => {
    state.items = state.items.filter((i) => i.id !== item.id);
    save();
  });

  const tr = el('tr', { id: `item-${item.id}` }, [
    el('td', {}, [textInput(item.name, (v) => (item.name = v))]),
    el('td', {}, [
      el('div', { style: 'display:flex;gap:4px;align-items:center' }, [categorySelect, el('span', {}, ['-']), dataNumberInput]),
    ]),
    el('td', {}, [
      el('div', { style: 'display:flex;gap:6px;align-items:center' }, [
        dataLengthSelect,
        item.dataLength === 'UINT32'
          ? el('span', { class: 'sub', style: 'margin:0' }, [`→ ${dataNumberRangeLabel(item)}`])
          : el('span', {}, []),
      ]),
    ]),
    el('td', {}, [textInput(item.unit, (v) => (item.unit = v))]),
    el('td', {}, [numberInput(item.offset, (v) => (item.offset = v))]),
    el('td', {}, [
      lsbInput(
        item.lsb,
        item.lsbText,
        (v, t) => {
          item.lsb = v;
          item.lsbText = t;
        },
        save
      ),
    ]),
    el('td', {}, [numberInput(item.max, (v) => (item.max = v))]),
    el('td', {}, [numberInput(item.min, (v) => (item.min = v))]),
    el('td', {}, [endianSelect]),
    el('td', {}, [deleteBtn]),
  ]);
  if (isDupe) tr.classList.add('dupe');
  return tr;
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = el('button', { class: primary ? 'primary' : '' }, [label]) as HTMLButtonElement;
  b.addEventListener('click', onClick);
  return b;
}

/** 分類内で次に割り当てるデータ番号。未登録なら1、登録済みなら末尾の次番号。 */
function nextDataNumber(categoryNumber: number): number {
  const existing = state.items.filter((i) => i.categoryNumber === categoryNumber);
  if (existing.length === 0) return 1;
  const maxOccupied = Math.max(...existing.flatMap((i) => occupiedDataNumbers(i)));
  return maxOccupied + 1;
}

function addItem(categoryNumber: number): void {
  const item: LoggerItemSpec = {
    id: uid(),
    name: '新規項目',
    categoryNumber,
    dataNumber: nextDataNumber(categoryNumber),
    dataLength: 'UINT16',
    unit: '',
    offset: 0,
    lsb: 1,
    max: 0,
    min: 0,
    endian: 'little',
  };
  state.items.push(item);
  save();
}

injectBaseStyles();
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    state = msg.data as LoggerSpecsFile;
    // render()はスクリプト読み込み直後にも一度(この非同期initが届く前、
    // state={categories:[],items:[]}のまま)呼ばれるため、そこでitemColWidths
    // が「データ無しの幅」のまま確定してしまわないよう、実データが届いた時点で
    // 必ず明示的に測り直す。
    itemColWidths = measureItemColWidths(state.items);
    render();
  }
});
api.postMessage({ type: 'ready' });
render();
