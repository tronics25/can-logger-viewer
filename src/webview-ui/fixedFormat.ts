// Webview UI: 固定フォーマットフレーム定義 エディタ
import { formatCanId, parseCanId } from '../decode/canId';
import { motorolaBitPosition } from '../decode/bits';
import { FixedFormatCanIdEntry, FixedFormatSignal } from '../models/types';
import { paletteColor } from './chartUtils';
import { clear, el, icon, injectBaseStyles, lsbInput, makeTableColumnsResizable, measureMaxCellWidth, vscodeApi } from './common';

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
    // 前後の空白が付いたままだと生ログのNAME列幅等に気づきにくい形で影響するため確定時に除く
    if (entry) entry.name = nameInput.value.trim();
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
    render(); // バイトグリッドの行数・オーバーフロー警告が変わるため再描画する
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
    el('div', { class: 'toolbar' }, [
      button('+ 信号を追加', addSignal, true),
      el('div', { class: 'spacer' }),
      button('Auto Fit', () => {
        // 手動リサイズをすべて解除し、実データに合わせた自動計測幅に戻す。
        signalColWidths = null;
        render();
      }),
    ]),
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
    const myIdx = idx.get(signal.id)!;
    for (let i = 0; i < signal.lengthBits; i++) {
      // little(Intel)=LSB起点で次バイトのLSB側へ継続、big(Motorola)=MSB起点で
      // 次バイトのMSB側へ継続。デコード側(extractBits)と同じ位置計算を使う。
      let byteIdx: number;
      let bitIdx: number;
      if (signal.byteOrder === 'big') {
        const pos = motorolaBitPosition(signal.byteOffset, signal.bitOffset, i);
        byteIdx = pos.byteIdx;
        bitIdx = pos.bitIdx;
      } else {
        const p = signal.byteOffset * 8 + signal.bitOffset + i;
        byteIdx = Math.floor(p / 8);
        bitIdx = p % 8;
      }
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

  // バイトを横一列8バイトずつ折り返して並べ、各バイトの中に8bitぶんのミニ
  // ストライプ (bit7が左〜bit0が右) を収める。実CANフレームの1行=8バイトの
  // 感覚に合わせて常に8列固定とし、コンテナ幅いっぱいにFillする
  // (auto-fillだと幅次第で1行の列数が変わってしまうため)。
  const grid = el('div', {
    style: 'display:grid;grid-template-columns:repeat(8,minmax(56px,1fr));gap:5px;',
  });
  for (let byteIdx = 0; byteIdx < frameLength; byteIdx++) {
    const strip = el('div', { style: 'display:flex;gap:1px;margin-top:3px;' });
    const namesInByte = new Set<string>();
    const idsInByte = new Set<string>();
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
        idsInByte.add(entry.signals[sigIdx].id);
      }
      strip.appendChild(el('div', { style: barStyle }));
    }
    const box = el(
      'div',
      {
        style: `border:1px solid var(--vscode-panel-border);border-radius:4px;padding:4px 5px;transition:box-shadow 0.1s;${
          byteHasOverlap ? 'border-color:var(--vscode-inputValidation-errorBorder,#c0392b);' : ''
        }`,
        title: byteHasOverlap ? '複数の信号が重複' : [...namesInByte].join(', ') || '未使用',
        // 信号一覧の行をホバー/編集中にした際、対応するバイトをここから
        // 探して枠を強調する (setByteHighlight参照)。
        'data-sig-ids': [...idsInByte].join('|'),
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
    {
      // max-widthで上限を切ってしまうと、パネルを広げてもグリッドが追従せず
      // 固定サイズに見えてしまうため、幅は親要素いっぱい(100%)まで伸びる
      // ようにする。狭いパネルでは1fr側の下限(minmax 56px)により横スクロール
      // (overflow-x:auto)にフォールバックする。
      // 高さも同様に固定のmax-heightで切ると、64バイト(8行)ちょうどの時に
      // 数px足りずスクロールバーが出てしまっていたため、内側では制限せず
      // ページ全体のスクロールに委ねる (最大でも8行なので、ページ内で
      // 許容できる高さに収まる)。
      style:
        'overflow-x:auto;border:1px solid var(--vscode-panel-border);' +
        'border-radius:4px;padding:8px;width:100%;min-width:504px;box-sizing:border-box;',
    },
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

/** 信号一覧の行をホバー/編集中にした際、バイトグリッド側の該当バイトを強調する。 */
function setByteHighlight(signalId: string, on: boolean): void {
  const boxes = document.querySelectorAll<HTMLElement>('[data-sig-ids]');
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if ((box.dataset.sigIds ?? '').split('|').includes(signalId)) {
      box.style.boxShadow = on ? '0 0 0 2px var(--vscode-focusBorder)' : '';
    }
  }
}

const SIGNAL_COL_LABELS = ['信号名', '単位', 'バイト位置', 'ビット位置', 'データ長(bit)', 'Lsb', 'オフセット', 'バイトオーダー', ''];

/**
 * 各列の実幅(px)。列境界のドラッグでこの配列を直接書き換えることで、
 * 再描画をまたいで手動リサイズを保持する。nullのままなら次のbuildSignalTable()
 * で実データに合わせた自動計測幅を算出する(Auto Fitボタンでもnullに戻す)。
 */
let signalColWidths: number[] | null = null;

/** 信号テーブルの列幅を、ヘッダーラベルと実際の信号値の表示幅から自動計測する。 */
function measureSignalColWidths(signals: FixedFormatSignal[]): number[] {
  const col = (i: number, extra: (Node | string)[], fallback: number) =>
    measureMaxCellWidth([SIGNAL_COL_LABELS[i], ...extra], fallback);
  return [
    col(0, signals.map((s) => s.name), 140),
    col(1, signals.map((s) => s.unit), 70),
    col(2, signals.map((s) => String(s.byteOffset)), 90),
    col(3, signals.map((s) => String(s.bitOffset)), 90),
    col(4, signals.map((s) => String(s.lengthBits)), 110),
    col(5, signals.map((s) => s.lsbText ?? formatLsbForMeasure(s.lsb)), 100),
    col(6, signals.map((s) => String(s.offset)), 100),
    col(7, ['Little', 'Big'], 110),
    36,
  ];
}

function formatLsbForMeasure(v: number): string {
  return Number.isFinite(v) ? v.toString() : '';
}

function buildSignalTable(): HTMLElement {
  const signals = entry?.signals ?? [];
  if (!signalColWidths) signalColWidths = measureSignalColWidths(signals);
  const widths = signalColWidths;
  const colgroup = el(
    'colgroup',
    {},
    widths.map((w) => el('col', { style: `width:${w}px` }))
  );
  const table = el('table', { style: 'table-layout:fixed' }, [
    colgroup,
    el('thead', {}, [el('tr', {}, SIGNAL_COL_LABELS.map((t) => el('th', {}, [t])))]),
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
        lsbInput(
          signal.lsb,
          signal.lsbText,
          (v, t) => {
            signal.lsb = v;
            signal.lsbText = t;
          },
          () => {
            save();
            render();
          }
        ),
      ]),
      el('td', {}, [numberInput(signal.offset, (v) => (signal.offset = v))]),
      el('td', {}, [byteOrderSelect(signal)]),
      el('td', {}, [deleteButton(signal.id)]),
    ]);
    if (overflow) tr.classList.add('dupe');
    // ホバー中/編集中(フォーカス中)は、上のバイトグリッドで該当バイトを強調する
    tr.addEventListener('mouseenter', () => setByteHighlight(signal.id, true));
    tr.addEventListener('mouseleave', () => setByteHighlight(signal.id, false));
    tr.addEventListener('focusin', () => setByteHighlight(signal.id, true));
    tr.addEventListener('focusout', () => setByteHighlight(signal.id, false));
    tbody.appendChild(tr);
    if (overflow) {
      tbody.appendChild(
        el('tr', {}, [el('td', { colspan: '9' }, [el('div', { class: 'warn' }, ['フレーム長を超える範囲が指定されています。'])])])
      );
    }
  }

  table.appendChild(tbody);
  makeTableColumnsResizable(table, widths);
  return table;
}

function textInput(value: string, onChange: (v: string) => void): HTMLInputElement {
  const input = el('input', { type: 'text', value }) as HTMLInputElement;
  input.addEventListener('change', () => {
    // 前後の空白(半角・全角とも)が付いたままだと見た目には気づきにくいまま
    // Auto Fitの列幅計算に影響してしまうため、確定時に取り除く。
    onChange(input.value.trim());
    save();
    render(); // 信号名はバイトグリッドの凡例・ホバー時のツールチップにも使われるため再描画する
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
    render(); // バイトグリッド上のこの信号の位置がLittle/Bigで変わるため再描画する
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
  // 空の場合は先頭(0,0)から。既存項目がある場合は、リスト末尾の項目が
  // 終わるビット位置から1ビットも空けずに続けて詰める (次のバイト境界まで
  // 切り上げると、詰め込み型のビットフィールドで無駄な隙間ができてしまう
  // ため、バイト境界をまたいでいてもビット単位でそのまま続きから始める)。
  // データ長は最後の項目と同じ値を初期値にする。
  const last = entry.signals[entry.signals.length - 1];
  const lastEndBit = last ? last.byteOffset * 8 + last.bitOffset + last.lengthBits : 0;
  const byteOffset = Math.min(entry.frameLength - 1, Math.floor(lastEndBit / 8));
  const bitOffset = lastEndBit % 8;
  const lengthBits = last ? last.lengthBits : 16;
  const signal: FixedFormatSignal = {
    id: uid(),
    name: '新規信号',
    unit: '',
    byteOffset,
    bitOffset,
    lengthBits,
    lsb: 1,
    offset: 0,
    // バイト位置/データ長の編集のたびに自動切替するとLittle運用時に毎回
    // 手動で直す手間が生じるため、追加時のみ「直前の信号と同じバイトオーダー」
    // を初期値にする(何も無ければLittle)。以降はユーザーが明示的に変えない
    // 限り自動では変わらない。
    byteOrder: last ? last.byteOrder : 'little',
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
