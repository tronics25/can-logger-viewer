// Webview UI: Logger CAN ID設定 (Logger 1〜6 ⇔ 実CAN ID)
import { formatCanId, parseCanId } from '../decode/canId';
import { CanIdRef, LoggerCanIdsFile, LoggerNumber } from '../models/types';
import { clear, el, injectBaseStyles, vscodeApi } from './common';

const api = vscodeApi();
let state: LoggerCanIdsFile = { assignments: [] };

function save(): void {
  api.postMessage({ type: 'save', data: state });
}

function render(): void {
  const r = document.getElementById('root')!;
  clear(r);

  r.append(
    el('h1', {}, ['Logger CAN ID設定']),
    el('div', { class: 'sub' }, [
      'Logger 1〜6それぞれに割り当てる実際のCAN IDを設定します。表記例: 標準ID「181」、拡張ID「3B012400x」。',
    ])
  );

  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, ['Logger番号', 'CAN ID'].map((t) => el('th', {}, [t])))]),
  ]);
  const tbody = el('tbody');

  for (let n = 1; n <= 6; n++) {
    const loggerNumber = n as LoggerNumber;
    const assignment = state.assignments.find((a) => a.loggerNumber === loggerNumber);
    const current: CanIdRef = assignment?.canId ?? { id: 0x180 + n, extended: false };

    const input = el('input', { type: 'text', class: 'mono', value: formatCanId(current), style: 'max-width:220px' }) as HTMLInputElement;
    const errorSpan = el('span', { class: 'warn' }, ['']);

    input.addEventListener('change', () => {
      const parsed = parseCanId(input.value);
      if (!parsed) {
        errorSpan.textContent = '不正なCAN ID表記です（例: 181, 3B012400x）';
        return;
      }
      errorSpan.textContent = '';
      const idx = state.assignments.findIndex((a) => a.loggerNumber === loggerNumber);
      if (idx >= 0) state.assignments[idx].canId = parsed;
      else state.assignments.push({ loggerNumber, canId: parsed });
      save();
    });

    tbody.appendChild(
      el('tr', {}, [
        el('td', {}, [`Logger ${n}`]),
        el('td', {}, [input, errorSpan]),
      ])
    );
  }

  table.appendChild(tbody);
  r.appendChild(table);
}

injectBaseStyles();
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    state = msg.data as LoggerCanIdsFile;
    render();
  }
});
api.postMessage({ type: 'ready' });
render();
