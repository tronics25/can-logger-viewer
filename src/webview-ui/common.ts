// Webview共通ユーティリティ: VS Code API取得・DOMヘルパー・共通スタイル注入。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function acquireVsCodeApi(): { postMessage(msg: any): void; getState(): any; setState(s: any): void };

let _api: ReturnType<typeof acquireVsCodeApi> | null = null;
export function vscodeApi() {
  if (!_api) _api = acquireVsCodeApi();
  return _api;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) continue;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * VS Code純正のCodiconアイコン (`media/codicons/`) を1文字表示する。
 * name は "trash" "add" "play" 等、`codicon-<name>` に対応する名称。
 */
export function icon(name: string, size?: string): HTMLElement {
  const style = size ? `font-size:${size}` : '';
  return el('i', { class: `codicon codicon-${name}`, style, 'aria-hidden': 'true' });
}

// Lsb (Resolution) 入力欄: 0.0000001〜1000000 (10^-7〜10^6) の範囲で、
// ▲/▼ボタンにより10倍/10分の1に増減できる (通常のtype=number spinnerは
// ±1刻みのため専用実装)。直接入力欄には10のべき乗以外の値も自由に入力できる。
// Logger項目仕様・固定フォーマットフレームの両エディタで共用する。
export const LSB_MIN = 1e-7;
export const LSB_MAX = 1e6;

export function clampLsb(v: number): number {
  const clamped = Math.min(LSB_MAX, Math.max(LSB_MIN, v));
  return Number(clamped.toPrecision(12));
}

export function formatLsb(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const fixed = v.toFixed(10);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

/**
 * @param onChange 値が変わったときに呼ばれ、呼び出し側の状態を更新する
 * @param onAfterChange 状態更新後の後処理 (save/render等、呼び出し側で定義)
 */
export function lsbInput(value: number, onChange: (v: number) => void, onAfterChange: () => void): HTMLElement {
  const input = el('input', {
    type: 'text',
    value: formatLsb(value),
    class: 'mono',
    style: 'width:84px;text-align:right',
  }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v) && v > 0) onChange(clampLsb(v));
    onAfterChange();
  });

  const step = (factor: number) => {
    onChange(clampLsb(value * factor));
    onAfterChange();
  };
  const btnStyle = 'line-height:8px;padding:0 3px;height:11px;';
  const up = el('button', { class: 'icon-btn', title: '×10', style: btnStyle }, [
    icon('chevron-up', '9px'),
  ]) as HTMLButtonElement;
  up.addEventListener('click', () => step(10));
  const down = el('button', { class: 'icon-btn', title: '÷10', style: btnStyle }, [
    icon('chevron-down', '9px'),
  ]) as HTMLButtonElement;
  down.addEventListener('click', () => step(0.1));

  const spinner = el('div', { style: 'display:flex;flex-direction:column' }, [up, down]);
  return el('div', { style: 'display:flex;align-items:center;gap:2px' }, [input, spinner]);
}

export function injectBaseStyles(): void {
  const style = document.createElement('style');
  style.textContent = BASE_CSS;
  document.head.appendChild(style);
}

const BASE_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 14px 18px 24px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  h1, h2, h3 { font-weight: 600; }
  h1 { font-size: 15px; margin: 0 0 4px; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: middle; }
  th { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.02em; color: var(--vscode-descriptionForeground); font-weight: 600; }
  tbody tr:hover:not(.group-row):not(.dupe) td { background: var(--vscode-list-hoverBackground); }
  tr.group-row td { background: var(--vscode-sideBar-background); font-weight: 600; }
  tr.dupe td { background: var(--vscode-inputValidation-errorBackground); }
  input[type=text], input[type=number], select {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    padding: 3px 6px;
    font-size: 12.5px;
    font-family: inherit;
    width: 100%;
  }
  input[type=text]:focus, input[type=number]:focus, select:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  select {
    -webkit-appearance: none;
    appearance: none;
    padding-right: 22px;
    background-repeat: no-repeat;
    background-position: right 6px center;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'><path d='M4 6l4 4 4-4' stroke='%238a8a8a' stroke-width='1.4' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 3px;
    padding: 5px 11px;
    font-size: 12.5px;
    cursor: pointer;
  }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { opacity: 0.9; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .spacer { flex: 1; }
  .warn { color: var(--vscode-errorForeground); font-size: 11px; padding: 4px 0; }
  .tag { font-size: 10.5px; padding: 1px 6px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .mono { font-family: var(--vscode-editor-font-family, monospace); }
  .icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    background: none; border: none; color: var(--vscode-icon-foreground);
    cursor: pointer; padding: 2px 4px; border-radius: 3px;
  }
  .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15)); opacity: 1; }
  .clamp-max { background: #fdf0dc; color: #b45309; font-weight: 700; border-radius: 3px; padding: 1px 6px; }
  .clamp-min { background: #f1ebfd; color: #6d28d9; font-weight: 700; border-radius: 3px; padding: 1px 6px; }
  .nc-cell { background: rgba(128,128,128,0.2); color: var(--vscode-descriptionForeground); font-style: italic; border-radius: 3px; padding: 1px 6px; }
  .sig-tok { display: inline-flex; gap: 3px; background: rgba(80,160,90,0.15); color: #2f6b3b; border-radius: 3px; padding: 1px 7px; margin: 1px 4px 1px 0; font-size: 11.5px; }

  /* セグメントコントロール (タブ/表示モード切替をピル型の一体ボタンにする) */
  .segmented { display: inline-flex; border: 1px solid var(--vscode-panel-border); border-radius: 5px; overflow: hidden; }
  .segmented button {
    border-radius: 0; background: var(--vscode-editor-background); color: var(--vscode-foreground);
    border-right: 1px solid var(--vscode-panel-border);
  }
  .segmented button:last-child { border-right: none; }
  .segmented button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }

  .codicon { font-size: 14px; line-height: 1; }

  /* 仮想スクロールテーブル (virtualList.ts) の行スタイル */
  .vgrid-row { border-bottom: 1px solid var(--vscode-panel-border); }
  .vgrid-row:hover { background: var(--vscode-list-hoverBackground); }
  .vgrid-row.dupe { background: var(--vscode-inputValidation-errorBackground); }
`;
