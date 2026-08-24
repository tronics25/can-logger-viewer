// Webview UI: 固定フォーマットフレーム定義 エディタ
import { formatCanId, parseCanId } from '../decode/canId';
import { FixedFormatCanIdEntry, FixedFormatSignal } from '../models/types';
import { paletteColor } from './chartUtils';
import { clear, el, icon, injectBaseStyles, lsbInput, vscodeApi } from './common';

const api = vscodeApi();
let entry: FixedFormatCanIdEntry | undefined;

const FRAME_LENGTHS = [8, 12, 16, 20, 24, 32, 48, 64];

function uid(): string {
  return `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function save(): void {
  if (entry) api.postMessage({ type: 'save', data: entry });
}

function render(): void {
  const r = document.getElementById('root')!;
  clear(r);
  if (!entry) {
    r.append(el('div', {}, ['読み込み中...']));
    return;
  }

  const idInput = el('input', { type: 'text', class: 'mono', value: formatCanId(entry.canId), style: 'max-width:160px' }) as HTMLInputElement;
  const idError = el('span', { class: 'warn' }, ['']);
  idInput.addEventListener('change', () => {
    const parsed = parseCanId(idInput.value);
    if (!parsed) {
      idError.textContent = '不正なCAN ID表記です';
      return;
    }
    idError.textContent = '';
    if (entry) entry.canId = parsed;
    save();
  });

  const nameInput = el('input', { type: 'text', value: entry.name, style: 'max-width:260px;font-weight:600' }) as HTMLInputElement;
  nameInput.addEventListener('change', () => {
    if (entry) entry.name = nameInput.value;
    save();
    render();
  });

  const lenSelect = el('select', { style: 'max-width:140px' }) as HTMLSelectElement;
  for (const len of FRAME_LENGTHS) {
    const opt = el('option', { value: String(len) }, [`${len}バイト${len > 8 ? ' (CAN FD)' : ''}`]) as HTMLOptionElement;
    if (entry.frameLength === len) opt.selected = true;
    lenSelect.appendChild(opt);
  }
  lenSelect.addEventListener('change', () => {
    if (entry) entry.frameLength = parseInt(lenSelect.value, 10);
    save();
  });

  r.append(
    el('h1', {}, ['固定フォーマットフレーム']),
    el('div', { class: 'toolbar' }, [
      el('span', {}, ['CAN ID:']),
      idInput,
      idError,
      el('span', {}, ['CANフレーム名:']),
      nameInput,
      el('span', {}, ['フレーム長:']),
      lenSelect,
      el('div', { class: 'spacer' }),
      button('JSONインポート', () => api.postMessage({ type: 'import' })),
      button('JSONエクスポート', () => api.postMessage({ type: 'export' })),
    ]),
    buildBitGrid(entry),
    el('div', { class: 'toolbar' }, [button('+ 信号を追加', addSignal, true)]),
    buildSignalTable(),
    el('div', { class: 'sub' }, [
      'バイト位置＋ビット位置＋データ長（ビット単位）で定義します。バイト位置＋ビット位置がフレーム長を超える設定は保存時に警告します。',
    ])
  );
}

/** signal.id -> 現在の信号一覧内でのインデックス (色割り当て・凡例と対応させる)。 */
function signalIndexMap(signals: FixedFormatSignal[]): Map<string, number> {
  const map = new Map<string, number>();
  signals.forEach((s, i) => map.set(s.id, i));
  return map;
}

/**
 * バイト×ビットの視覚的なレイアウト表示。どのビット範囲がどの信号に
 * 割り当てられているか、また信号同士でビットが重複していないかを一目で
 * 確認できるようにする (デコード側の extractBits と同じビット数え方:
 * バイト内 bit0=LSB、byteOffset*8+bitOffset から lengthBits ぶん占有)。
 */
function buildBitGrid(entry: FixedFormatCanIdEntry): HTMLElement {
  const frameLength = entry.frameLength;
  const idx = signalIndexMap(entry.signals);
  // -1=未使用, -2=複数信号が重複, それ以外=信号インデックス
  const cell: number[][] = Array.from({ length: frameLength }, () => new Array(8).fill(-1));
  const overlapping = new Set<string>();

  for (const signal of entry.signals) {
    const start = signal.byteOffset * 8 + signal.bitOffset;
    const myIdx = idx.get(signal.id)!;
    for (let p = start; p < start + signal.lengthBits; p++) {
      const byteIdx = Math.floor(p / 8);
      const bitIdx = p % 8;
      if (byteIdx < 0 || byteIdx >= frameLength) continue; // フレーム長超過分はテーブル側の警告で扱う
      const existing = cell[byteIdx][bitIdx];
      if (existing === -1) {
        cell[byteIdx][bitIdx] = myIdx;
      } else if (existing !== myIdx) {
        cell[byteIdx][bitIdx] = -2;
        overlapping.add(signal.id);
        const otherSignal = entry.signals.find((s) => idx.get(s.id) === existing);
        if (otherSignal) overlapping.add(otherSignal.id);
      }
    }
  }

  // バイトを縦に積み上げず折り返して並べ、各バイトの中に8bitぶんのミニ
  // ストライプ (bit7が左〜bit0が右) を収める。CAN FDの64バイトでも
  // 縦に長くなりすぎないようにするため。
  const grid = el('div', {
    style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(52px,1fr));gap:5px;',
  });
  for (let byteIdx = 0; byteIdx < frameLength; byteIdx++) {
    const strip = el('div', { style: 'display:flex;gap:1px;margin-top:3px;' });
    const namesInByte = new Set<string>();
    let byteHasOverlap = false;
    for (let b = 7; b >= 0; b--) {
      const sigIdx = cell[byteIdx][b];
      let barStyle = 'flex:1;height:11px;border-radius:1px;';
      if (sigIdx === -1) {
        barStyle += 'border:1px dashed var(--vscode-panel-border);';
      } else if (sigIdx === -2) {
        barStyle += 'background:var(--vscode-inputValidation-errorBackground);border:1px solid var(--vscode-inputValidation-errorBorder,#c0392b);';
        byteHasOverlap = true;
      } else {
        const color = paletteColor(sigIdx);
        barStyle += `background:${color}66;border:1px solid ${color};`;
        namesInByte.add(entry.signals[sigIdx]?.name || '(無名信号)');
      }
      strip.appendChild(el('div', { style: barStyle }));
    }
    const box = el(
      'div',
      {
        style: `border:1px solid var(--vscode-panel-border);border-radius:4px;padding:4px 5px;${
          byteHasOverlap ? 'border-color:var(--vscode-inputValidation-errorBorder,#c0392b);' : ''
        }`,
        title: byteHasOverlap ? '複数の信号が重複' : [...namesInByte].join(', ') || '未使用',
      },
      [
        el('div', { class: 'mono', style: 'font-size:9.5px;color:var(--vscode-descriptionForeground);text-align:center' }, [
          `B${byteIdx}`,
        ]),
        strip,
      ]
    );
    grid.appendChild(box);
  }

  const scrollWrap = el(
    'div',
    { style: 'max-height:300px;overflow-y:auto;border:1px solid var(--vscode-panel-border);border-radius:4px;padding:8px;max-width:700px' },
    [grid]
  );

  const legend = el('div', { style: 'display:flex;gap:14px;flex-wrap:wrap;margin:8px 0;font-size:11px' });
  entry.signals.forEach((signal, i) => {
    const isOverlap = overlapping.has(signal.id);
    const color = isOverlap ? 'var(--vscode-errorForeground)' : paletteColor(i);
    legend.appendChild(
      el('span', { style: 'display:flex;align-items:center;gap:5px' }, [
        el('span', { style: `display:inline-block;width:10px;height:10px;border-radius:2px;background:${color}` }),
        signal.name || '(無名信号)',
        ...(isOverlap ? [icon('warning', '11px')] : []),
      ])
    );
  });
  legend.appendChild(
    el('span', { style: 'display:flex;align-items:center;gap:5px;color:var(--vscode-descriptionForeground)' }, [
      el('span', { style: 'display:inline-block;width:10px;height:10px;border-radius:2px;border:1px dashed var(--vscode-panel-border)' }),
      '未使用',
    ])
  );

  const wrap = el('div', {}, [scrollWrap, legend]);
  if (overlapping.size > 0) {
    wrap.appendChild(
      el('div', { class: 'warn' }, ['ビット範囲が重複している信号があります（グリッド上に赤で表示、上の凡例にも警告マーク）。'])
    );
  }
  return wrap;
}

function buildSignalTable(): HTMLElement {
  const table = el('table', {}, [
    el('thead', {}, [
      el(
        'tr',
        {},
        ['信号名', '単位', 'バイト位置', 'ビット位置', 'データ長(bit)', 'Lsb', 'オフセット', 'バイトオーダー', ''].map((t) =>
          el('th', {}, [t])
        )
      ),
    ]),
  ]);
  const tbody = el('tbody');

  for (const signal of entry?.signals ?? []) {
    const overflow = entry ? signal.byteOffset + Math.ceil((signal.bitOffset + signal.lengthBits) / 8) > entry.frameLength : false;
    const tr = el('tr', {}, [
      el('td', {}, [textInput(signal.name, (v) => (signal.name = v))]),
      el('td', {}, [textInput(signal.unit, (v) => (signal.unit = v))]),
      el('td', {}, [
        numberInput(signal.byteOffset, (v) => (signal.byteOffset = v), {
          min: 0,
          max: entry ? entry.frameLength - 1 : undefined,
        }),
      ]),
      el('td', {}, [numberInput(signal.bitOffset, (v) => (signal.bitOffset = v), { min: 0, max: 7 })]),
      el('td', {}, [numberInput(signal.lengthBits, (v) => (signal.lengthBits = v), { min: 1, max: 32 })]),
      el('td', {}, [
        lsbInput(signal.lsb, (v) => (signal.lsb = v), () => {
          save();
          render();
        }),
      ]),
      el('td', {}, [numberInput(signal.offset, (v) => (signal.offset = v))]),
      el('td', {}, [byteOrderSelect(signal)]),
      el('td', {}, [deleteButton(signal.id)]),
    ]);
    if (overflow) tr.classList.add('dupe');
    tbody.appendChild(tr);
    if (overflow) {
      tbody.appendChild(
        el('tr', {}, [el('td', { colspan: '9' }, [el('div', { class: 'warn' }, ['フレーム長を超える範囲が指定されています。'])])])
      );
    }
  }

  table.appendChild(tbody);
  return table;
}

function textInput(value: string, onChange: (v: string) => void): HTMLInputElement {
  const input = el('input', { type: 'text', value }) as HTMLInputElement;
  input.addEventListener('change', () => {
    onChange(input.value);
    save();
  });
  return input;
}

function numberInput(
  value: number,
  onChange: (v: number) => void,
  bounds?: { min?: number; max?: number }
): HTMLInputElement {
  const attrs: Record<string, string> = { type: 'number', value: String(value), class: 'mono' };
  if (bounds?.min !== undefined) attrs.min = String(bounds.min);
  if (bounds?.max !== undefined) attrs.max = String(bounds.max);
  const input = el('input', attrs) as HTMLInputElement;
  input.addEventListener('change', () => {
    let v = parseFloat(input.value);
    if (Number.isNaN(v)) {
      render();
      return;
    }
    // min/max属性はスピナー(▲▼)のみ制限し、キーボード入力では超えた値を
    // 入力できてしまうため、保存前に範囲内へ丸める。
    if (bounds?.min !== undefined && v < bounds.min) v = bounds.min;
    if (bounds?.max !== undefined && v > bounds.max) v = bounds.max;
    onChange(v);
    save();
    render();
  });
  return input;
}

function byteOrderSelect(signal: FixedFormatSignal): HTMLSelectElement {
  const select = el('select') as HTMLSelectElement;
  for (const [value, label] of [['little', 'Little'], ['big', 'Big']] as const) {
    const opt = el('option', { value }, [label]) as HTMLOptionElement;
    if (signal.byteOrder === value) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    signal.byteOrder = select.value as 'little' | 'big';
    save();
  });
  return select;
}

function deleteButton(signalId: string): HTMLButtonElement {
  const b = el('button', { class: 'icon-btn', title: '削除' }, [icon('trash')]) as HTMLButtonElement;
  b.addEventListener('click', () => {
    if (entry) entry.signals = entry.signals.filter((s) => s.id !== signalId);
    save();
    render();
  });
  return b;
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = el('button', { class: primary ? 'primary' : '' }, [label]) as HTMLButtonElement;
  b.addEventListener('click', onClick);
  return b;
}

function addSignal(): void {
  if (!entry) return;
  const signal: FixedFormatSignal = {
    id: uid(),
    name: '新規信号',
    unit: '',
    byteOffset: 0,
    bitOffset: 0,
    lengthBits: 16,
    lsb: 1,
    offset: 0,
    byteOrder: 'little',
  };
  entry.signals.push(signal);
  save();
  render();
}

injectBaseStyles();
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    entry = msg.entry;
    render();
  }
});
api.postMessage({ type: 'ready' });
render();
