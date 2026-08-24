// Webview UI: Loggerマッピングプロファイル エディタ
import { formatCanId } from '../decode/canId';
import {
  CanIdRef,
  LoggerItemSpec,
  LoggerMappingProfile,
  LoggerNumber,
  dataNumberRangeLabel,
  slotCountFor,
} from '../models/types';
import { clear, el, icon, injectBaseStyles, vscodeApi } from './common';

const api = vscodeApi();
let profile: LoggerMappingProfile | undefined;
let items: LoggerItemSpec[] = [];
let canIds: { assignments: { loggerNumber: LoggerNumber; canId: CanIdRef }[] } = { assignments: [] };
let selectedLogger: LoggerNumber = 1;

function itemLabel(item: LoggerItemSpec): string {
  return `${item.name} (${item.categoryNumber}-${dataNumberRangeLabel(item)})`;
}

function save(): void {
  if (profile) api.postMessage({ type: 'save', data: profile });
}

function canIdFor(loggerNumber: LoggerNumber): string {
  const a = canIds.assignments.find((x) => x.loggerNumber === loggerNumber);
  return a ? formatCanId(a.canId) : '?';
}

function render(): void {
  const r = document.getElementById('root')!;
  clear(r);
  if (!profile) {
    r.append(el('div', {}, ['読み込み中...']));
    return;
  }

  const nameInput = el('input', { type: 'text', value: profile.name, style: 'max-width:260px;font-weight:600' }) as HTMLInputElement;
  nameInput.addEventListener('change', () => {
    if (profile) profile.name = nameInput.value;
    save();
  });

  r.append(
    el('h1', {}, ['Loggerマッピング']),
    el('div', { class: 'toolbar' }, [
      el('span', {}, ['プロファイル名:']),
      nameInput,
      el('div', { class: 'spacer' }),
      button('JSONインポート', () => api.postMessage({ type: 'import' })),
      button('JSONエクスポート', () => api.postMessage({ type: 'export' })),
    ])
  );

  const layout = el('div', { style: 'display:flex;gap:20px;align-items:flex-start' });
  layout.append(buildLoggerList(), buildSlotPanel());
  r.appendChild(layout);
}

function buildLoggerList(): HTMLElement {
  const list = el('div', { style: 'width:220px;flex:0 0 220px' });
  for (let n = 1; n <= 5; n++) {
    const loggerNumber = n as LoggerNumber;
    const used = (profile?.slots[loggerNumber] ?? []).filter((s) => s.itemId).length;
    const total = (profile?.slots[loggerNumber] ?? []).length;
    const row = el(
      'div',
      {
        style: `padding:8px 10px;border-radius:4px;cursor:pointer;margin-bottom:2px;${
          loggerNumber === selectedLogger ? 'background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);' : ''
        }`,
      },
      [
        el('div', { class: 'mono', style: 'font-weight:600' }, [canIdFor(loggerNumber)]),
        el('div', { class: 'sub', style: 'margin:0' }, [`${used} / ${total} スロット使用`]),
      ]
    );
    row.addEventListener('click', () => {
      selectedLogger = loggerNumber;
      render();
    });
    list.appendChild(row);
  }
  return list;
}

function nextFreeSlotNumber(slots: { slot: number }[]): number {
  return slots.length ? Math.max(...slots.map((s) => s.slot)) + 1 : 0;
}

function duplicateSlotNumbers(slots: { slot: number }[]): Set<number> {
  const counts = new Map<number, number>();
  for (const s of slots) counts.set(s.slot, (counts.get(s.slot) ?? 0) + 1);
  const dupes = new Set<number>();
  for (const [n, c] of counts) if (c > 1) dupes.add(n);
  return dupes;
}

function buildSlotPanel(): HTMLElement {
  const panel = el('div', { style: 'flex:1;min-width:0' });
  const slots = [...(profile?.slots[selectedLogger] ?? [])].sort((a, b) => a.slot - b.slot);
  const dupes = duplicateSlotNumbers(slots);

  const toolbar = el('div', { class: 'toolbar' }, [
    el('h3', { style: 'margin:0' }, [`${canIdFor(selectedLogger)} のスロット`]),
    el('div', { class: 'spacer' }),
    button('+ スロット追加', () => {
      if (!profile) return;
      const arr = profile.slots[selectedLogger];
      arr.push({ slot: nextFreeSlotNumber(arr), itemId: null });
      save();
      render();
    }),
  ]);
  panel.appendChild(toolbar);
  panel.appendChild(
    el('div', { class: 'sub' }, [
      'スロット番号は自由に指定できます（例: 4を指定するとバイト8から）。番号を空けた範囲は未使用（応答0xFFFF）として扱われます。',
    ])
  );

  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, ['スロット', 'バイト位置', '項目', '分類-データ番号', 'データ長', ''].map((t) => el('th', {}, [t])))]),
  ]);
  const tbody = el('tbody');

  for (const slot of slots) {
    const item = items.find((i) => i.id === slot.itemId);
    const isEmpty = !item;
    const byteLen = item ? slotCountFor(item.dataLength) * 2 : 2;
    const byteStart = slot.slot * 2;
    const isDupe = dupes.has(slot.slot);

    const slotInput = el('input', { type: 'number', value: String(slot.slot), class: 'mono', style: 'max-width:70px' }) as HTMLInputElement;
    slotInput.addEventListener('change', () => {
      const v = parseInt(slotInput.value, 10);
      if (!Number.isNaN(v) && v >= 0) slot.slot = v;
      save();
      render();
    });

    const select = el('select') as HTMLSelectElement;
    select.appendChild(el('option', { value: '' }, ['（未設定 — 応答0xFFFF）']) as HTMLOptionElement);
    for (const it of items) {
      const opt = el('option', { value: it.id }, [itemLabel(it)]) as HTMLOptionElement;
      if (it.id === slot.itemId) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      slot.itemId = select.value || null;
      save();
      render();
    });

    const delBtn = el('button', { class: 'icon-btn', title: 'スロットを削除' }, [icon('trash')]);
    delBtn.addEventListener('click', () => {
      if (!profile) return;
      profile.slots[selectedLogger] = profile.slots[selectedLogger].filter((s) => s !== slot);
      save();
      render();
    });

    const tr = el('tr', {}, [
      el('td', {}, [slotInput]),
      el('td', { class: 'mono' }, [`${byteStart}-${byteStart + byteLen - 1}`]),
      el('td', {}, [select]),
      el('td', { class: 'mono' }, [item ? `${item.categoryNumber}-${dataNumberRangeLabel(item)}` : '0-0']),
      el('td', {}, [isEmpty ? el('span', { class: 'nc-cell' }, ['0xFFFF']) : el('span', { class: 'tag' }, [item!.dataLength])]),
      el('td', {}, [delBtn]),
    ]);
    if (isDupe) tr.classList.add('dupe');
    tbody.appendChild(tr);
    if (isDupe) {
      tbody.appendChild(
        el('tr', {}, [el('td', { colspan: '6' }, [el('div', { class: 'warn' }, [`スロット番号 ${slot.slot} が重複しています。`])])])
      );
    }
  }

  table.appendChild(tbody);
  panel.appendChild(table);
  panel.appendChild(
    el('div', { class: 'sub' }, [
      '未設定スロットは応答時0xFFFFになり、生ログ・グラフでは「未設定(N.C.)」として表示されます。',
    ])
  );
  return panel;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', {}, [label]) as HTMLButtonElement;
  b.addEventListener('click', onClick);
  return b;
}

injectBaseStyles();
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    profile = msg.profile;
    items = msg.items;
    canIds = msg.canIds;
    render();
  }
});
api.postMessage({ type: 'ready' });
render();
