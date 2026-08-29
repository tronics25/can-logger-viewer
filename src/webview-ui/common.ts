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

/** セル1つ分のpadding (左右合計)。measureMaxCellWidthの実測にも使う。 */
const CELL_PADDING_PX = 16;
const MIN_MEASURED_WIDTH = 80;
const MAX_MEASURED_WIDTH = 2200;

/**
 * 候補となるセル内容 (Node/文字列) の中で最も幅を取るものを実際にDOMへ
 * 一時挿入して計測し、そのpx幅を返す (列幅を実データに合わせて決めるための
 * ヘルパー。仮想スクロールテーブル・通常のtableどちらの列幅算出にも使う共通
 * ユーティリティ)。
 */
export function measureMaxCellWidth(candidates: (Node | string)[], fallback = 120): number {
  if (candidates.length === 0) return fallback;
  const probe = el('div', {
    style: 'position:absolute;visibility:hidden;left:-9999px;top:-9999px;white-space:nowrap;',
  });
  document.body.appendChild(probe);
  let max = 0;
  for (const c of candidates) {
    const span = el('span', {
      style: `display:inline-block;padding:0 ${CELL_PADDING_PX / 2}px;font-size:12.5px;white-space:nowrap;`,
    });
    span.append(c);
    probe.appendChild(span);
    max = Math.max(max, span.getBoundingClientRect().width);
    probe.removeChild(span);
  }
  document.body.removeChild(probe);
  return Math.min(MAX_MEASURED_WIDTH, Math.max(MIN_MEASURED_WIDTH, Math.ceil(max) + 4));
}

const MIN_RESIZABLE_COL_WIDTH = 32;

/**
 * <table>(colgroup + <col>×N、thead>tr>th×N)に列境界のドラッグリサイズを
 * 追加する。widthsPx配列を直接書き換え、呼び出し側の同じ配列を次回描画時にも
 * 使い回すことで、再描画をまたいで手動リサイズした幅が保持される。ドラッグ
 * 終了時にonResizeを呼ぶ(呼び出し側で何かフックしたい場合用、必須ではない)。
 */
export function makeTableColumnsResizable(table: HTMLTableElement, widthsPx: number[], onResize?: () => void): void {
  const cols = table.querySelectorAll('colgroup > col');
  const ths = table.querySelectorAll('thead th');
  ths.forEach((thEl, i) => {
    if (i >= widthsPx.length) return;
    const th = thEl as HTMLElement;
    th.style.position = 'relative';
    th.style.overflow = 'hidden';
    th.style.textOverflow = 'ellipsis';
    th.style.whiteSpace = 'nowrap';
    const handle = el('div', {
      style: 'position:absolute;top:0;right:-4px;width:7px;height:100%;cursor:col-resize;z-index:2;',
    });
    handle.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const startX = (ev as MouseEvent).clientX;
      const startWidth = widthsPx[i];
      const onMove = (mv: MouseEvent) => {
        const newWidth = Math.max(MIN_RESIZABLE_COL_WIDTH, startWidth + (mv.clientX - startX));
        widthsPx[i] = newWidth;
        const col = cols[i] as HTMLElement | undefined;
        if (col) col.style.width = `${newWidth}px`;
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        onResize?.();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    th.appendChild(handle);
  });
}

export function clear(node: Element): void {
  // フォーカス中の要素を持ったまま子要素をまとめて破棄すると、ブラウザが
  // フォーカスの移動先を探す際に暗黙的にスクロールしてしまうことがある
  // (Windows/ChromiumはmacOSと違い、ボタンをクリックした時点で実際に
  // フォーカスが移るため顕在化する。例: LSBの▲/▼ボタン連打で毎回render()
  // が走り、そのたびにリストが勝手にスクロールして見える不具合)。
  // 破棄前に明示的にblurしておくことで、この暗黙スクロールを防ぐ。
  if (document.activeElement instanceof HTMLElement && node.contains(document.activeElement)) {
    document.activeElement.blur();
  }
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
 * "1/128"のような分数表記、または通常の小数/整数の文字列をパースする。
 * 実機の信号仕様書はLSBを小数ではなく分数(実質シフト演算)で記載している
 * ことが多く、都度手計算で小数に変換させると入力ミスの元になるため対応する。
 * 分数は num/den を素直にJSの浮動小数点除算した結果を返す(2の累乗を分母に
 * 持つ一般的なケースはIEEE754上ちょうど誤差なく表現できる)。
 */
export function parseLsbExpr(text: string): number | null {
  const trimmed = text.trim();
  const fraction = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (fraction) {
    const num = parseFloat(fraction[1]);
    const den = parseFloat(fraction[2]);
    if (Number.isNaN(num) || Number.isNaN(den) || den === 0) return null;
    return num / den;
  }
  const v = parseFloat(trimmed);
  return Number.isNaN(v) ? null : v;
}

/** vが2の累乗(...0.25, 0.5, 1, 2, 4...)かどうか(浮動小数点誤差を許容して判定)。 */
function isPowerOfTwo(v: number): boolean {
  if (!(v > 0)) return false;
  const log2 = Math.log2(v);
  return Math.abs(log2 - Math.round(log2)) < 1e-9;
}

/** vが10の累乗(...0.01, 0.1, 1, 10, 100...)かどうか(浮動小数点誤差を許容して判定)。 */
function isPowerOfTen(v: number): boolean {
  if (!(v > 0)) return false;
  const log10 = Math.log10(v);
  return Math.abs(log10 - Math.round(log10)) < 1e-9;
}

/**
 * Up/Downボタン1回ぶんの刻み幅(2倍刻みか10倍刻みか)を決める。1は10の累乗でも
 * 2の累乗でもあるため、先に10の累乗かどうかを判定する(10の累乗なら常に
 * 桁上げ/桁下げを優先し、デフォルト値1からのステップも従来通り10倍/10分の1の
 * ままにする)。10の累乗でなく、かつ2の累乗(2,4,8,16,0.5,0.25...)ならビット
 * シフト単位の並びに沿うよう2倍/2分の1で刻む。どちらでもない値(30, 3, 0.3等)
 * は10倍/10分の1。
 */
function lsbStepBase(value: number): 2 | 10 {
  if (isPowerOfTen(value)) return 10;
  if (isPowerOfTwo(value)) return 2;
  return 10;
}

/**
 * 分数表記("1/128"等)でのステップ時だけ使う判定順。分数入力はビットシフト
 * 単位(2の累乗)の並びを仕様書通りに保つのが主目的のため、10の累乗より先に
 * 2の累乗かどうかを見る(1は2の累乗側になり、10/1→1/1→1/2→1/4と続く)。
 * どちらでもない値(30, 3等)は10倍/10分の1のまま。
 */
function lsbStepBaseForFraction(value: number): 2 | 10 {
  if (isPowerOfTwo(value)) return 2;
  if (isPowerOfTen(value)) return 10;
  return 10;
}

function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

/** "a/b"形式(分子・分母とも整数)をパースする。整数比でなければnull。 */
function parseIntFraction(text: string): { n: number; d: number } | null {
  const m = text.trim().match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (!m) return null;
  const d = parseInt(m[2], 10);
  if (d === 0) return null;
  return { n: parseInt(m[1], 10), d };
}

/**
 * @param displayText 分数表記("1/128"等)で入力された場合、その元テキストを渡すと
 *   次回の再描画でも仕様書通りの表記のまま表示し続ける(未指定なら通常の小数表示)。
 * @param onChange 値が変わったときに呼ばれ、呼び出し側の状態を更新する。
 *   第2引数は上のdisplayText用の保存値 (分数入力でなければundefined)。
 * @param onAfterChange 状態更新後の後処理 (save/render等、呼び出し側で定義)
 */
export function lsbInput(
  value: number,
  displayText: string | undefined,
  onChange: (v: number, displayText: string | undefined) => void,
  onAfterChange: () => void
): HTMLElement {
  const input = el('input', {
    type: 'text',
    value: displayText ?? formatLsb(value),
    class: 'mono',
    style: 'width:84px;text-align:right',
  }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const raw = input.value;
    const v = parseLsbExpr(raw);
    if (v !== null && v > 0) {
      // 分数表記で入力された場合だけ元テキストを保持する。普通の数値入力
      // なら次回はformatLsb()による通常表示に任せる。
      onChange(clampLsb(v), raw.includes('/') ? raw.trim() : undefined);
    }
    onAfterChange();
  });

  // up=true(×)なら分子に、down(÷)なら分母に刻み幅(2 or 10)を掛けてから
  // 約分する。例: 10/1→1/1→1/2→1/4、4/1→2/1→1/1→1/2→1/4、
  // 1/2→1/4→1/8→1/16、30/1→3/1→3/10→3/100。分数表記で入力された値だけ
  // この分数のままのステップにし、普通の数値入力ならこれまで通り小数のまま
  // 掛け算/割り算する(こちらは10の累乗判定が優先、分数側は2の累乗判定が優先)。
  const fractionNow = displayText ? parseIntFraction(displayText) : null;
  const step = (up: boolean) => {
    if (fractionNow) {
      const base = lsbStepBaseForFraction(value);
      let { n, d } = fractionNow;
      if (up) n *= base;
      else d *= base;
      const g = gcd(n, d);
      n /= g;
      d /= g;
      onChange(clampLsb(n / d), `${n}/${d}`);
    } else {
      const base = lsbStepBase(value);
      const factor = up ? base : 1 / base;
      onChange(clampLsb(value * factor), undefined);
    }
    onAfterChange();
  };
  const btnStyle = 'line-height:8px;padding:0 3px;height:11px;';
  const stepLabel = String(fractionNow ? lsbStepBaseForFraction(value) : lsbStepBase(value));
  const up = el('button', { class: 'icon-btn', title: `×${stepLabel}`, style: btnStyle }, [
    icon('chevron-up', '9px'),
  ]) as HTMLButtonElement;
  up.addEventListener('click', () => step(true));
  const down = el('button', { class: 'icon-btn', title: `÷${stepLabel}`, style: btnStyle }, [
    icon('chevron-down', '9px'),
  ]) as HTMLButtonElement;
  down.addEventListener('click', () => step(false));

  const spinner = el('div', { style: 'display:flex;flex-direction:column' }, [up, down]);
  return el('div', { style: 'display:flex;align-items:center;gap:2px' }, [input, spinner]);
}

export function injectBaseStyles(): void {
  const style = document.createElement('style');
  style.textContent = BASE_CSS;
  document.head.appendChild(style);
  installFocusWorkaround();
}

/**
 * VS Codeのwebviewパネルを開いた/切り替えた直後は、OSレベルのフォーカスが
 * webview(iframe)自体にまだ入っていないことがある。その状態で入力欄等を
 * クリックすると、1回目のクリックが「webviewにフォーカスを移す」ことに
 * 消費されてしまい、クリックした要素自体には実際のフォーカス/キャレットが
 * 入らず、もう一度クリックしないと入力できないことがある(Windows環境で
 * 報告あり、macOSでは未確認)。mousedownの捕捉フェーズで対象のフォーム
 * 要素へ明示的にfocus()を要求することで、1回目のクリックで確実に
 * フォーカスさせる。
 */
function installFocusWorkaround(): void {
  document.addEventListener(
    'mousedown',
    (e) => {
      const target = e.target as HTMLElement | null;
      const field = target?.closest('input, select, textarea, button') as HTMLElement | null;
      if (field && document.activeElement !== field) field.focus();
    },
    true
  );
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
  /* 編集中(フォーカス中)の行を、ホバーが外れても分かるように色を変える */
  tbody tr:focus-within:not(.group-row):not(.dupe) td { background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground)); }
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
