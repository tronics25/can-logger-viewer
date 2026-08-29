// 依存ライブラリなしの仮想スクロールテーブル。
// 数万行規模のログでも、実際に画面に見えている行だけをDOMに生成することで
// スクロールを軽快に保つ (行の高さは固定を前提とする)。
import { el, measureMaxCellWidth } from './common';

export { measureMaxCellWidth };

export interface VirtualColumn {
  label: string;
  /**
   * 列幅 (px固定値のみ、例: "90px")。
   * ヘッダーと各行は別々のCSS Grid (translateYで縦位置をずらす仮想スクロール
   * のため) なので、"1fr"/"minmax(...,1fr)"のような可変トラックを使うと行
   * ごとに実際の描画幅が変わってしまいヘッダーとズレる。横スクロールに対応
   * するため列幅は必ずpx固定値にし、全列の合計px幅をテーブル全体の実幅とする。
   */
  width: string;
}

export interface VirtualTableOptions {
  columns: VirtualColumn[];
  rowCount: number;
  /** 1行の高さ(px)。全行固定とする。省略時 26px */
  rowHeight?: number;
  /** 行indexを受け取り、列の並び順でセルの中身を返す */
  renderRow(index: number): (Node | string)[];
  /** 行に付与する追加クラス (例: 'dupe' で警告色にする等) */
  rowClassName?(index: number): string | undefined;
  emptyMessage?: string;
  /** スクロール領域の高さ。省略時は親要素にflex:1で合わせる */
  height?: string;
  /**
   * ユーザーが列境界をドラッグで手動リサイズした幅(ラベルごと、px)。
   * 指定があればcolumns[].widthより優先する。呼び出し側がモジュール変数等で
   * 保持し、再描画のたびに同じMapを渡すことで、手動リサイズが再描画をまたいで
   * 保持される(逆に呼び出し側でMapをクリアすれば「自動調整」に戻せる)。
   */
  columnWidthOverrides?: Map<string, number>;
  /** 列境界のドラッグリサイズが終わった時に呼ばれる(ラベルと確定後のpx幅)。 */
  onColumnResize?(label: string, widthPx: number): void;
}

export interface VirtualTableHandle {
  /** データ件数や内容が変わった際に再描画する */
  refresh(rowCount?: number): void;
  scrollToIndex(index: number): void;
}

const DEFAULT_ROW_HEIGHT = 26;
const OVERSCAN = 6;
const MIN_COL_WIDTH = 32;

export function renderVirtualTable(host: HTMLElement, options: VirtualTableOptions): VirtualTableHandle {
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
  // 手動リサイズされた幅(columnWidthOverrides、ラベル一致)があればそれを、
  // なければcolumns[].widthを初期値として使う、可変の実幅配列。
  const liveWidths: number[] = options.columns.map(
    (c) => options.columnWidthOverrides?.get(c.label) ?? (parseInt(c.width, 10) || 0)
  );
  const gridColumnsStr = () => liveWidths.map((w) => `${w}px`).join(' ');
  const totalWidthPx = () => liveWidths.reduce((sum, w) => sum + w, 0);
  let rowCount = options.rowCount;

  host.innerHTML = '';
  host.style.display = 'block';
  host.style.position = 'relative';
  host.style.border = '1px solid var(--vscode-panel-border)';
  host.style.borderRadius = '4px';
  // 縦横どちらのスクロールも、この1つの要素(host)だけで扱う。ヘッダーと
  // 行本体を別要素(host > header + 別のoverflow:autoな内側body)に分けると、
  // 内側bodyの実幅が列合計幅ぶん広がるため、その"自分の右端"に出る縦スクロール
  // バーが可視領域の外（横スクロールしないと見えない位置）に出てしまう。
  // hostひとつだけをスクロールコンテナにすれば、縦横とも常に可視領域の端に
  // スクロールバーが出る (ブラウザの標準的なoverflow:autoの挙動)。
  host.style.overflowX = 'auto';
  host.style.overflowY = 'auto';
  if (options.height) host.style.height = options.height;
  else host.style.flex = '1';
  host.style.minHeight = '0';

  if (rowCount === 0) {
    host.appendChild(el('div', { class: 'sub', style: 'padding:12px' }, [options.emptyMessage ?? 'データがありません。']));
    return { refresh: () => {}, scrollToIndex: () => {} };
  }

  // ヘッダーはposition:stickyでhost内の上端に固定する。縦スクロールでは
  // 常に見える位置に留まりつつ、横スクロールには追従して一緒に動く。
  const header = el('div', {
    style:
      `display:grid;grid-template-columns:${gridColumnsStr()};width:${totalWidthPx()}px;min-width:${totalWidthPx()}px;` +
      'position:sticky;top:0;z-index:1;' +
      'border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);',
  });
  options.columns.forEach((col, i) => {
    const headerCell = el('div', {
      style:
        'position:relative;padding:6px 8px;font-size:10.5px;text-transform:uppercase;letter-spacing:0.02em;' +
        'color:var(--vscode-descriptionForeground);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
    });
    headerCell.append(col.label);
    // 列境界のドラッグリサイズハンドル(ヘッダーセル右端の細い帯)。
    const handle = el('div', {
      style: 'position:absolute;top:0;right:-4px;width:7px;height:100%;cursor:col-resize;z-index:2;',
    });
    handle.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const startX = (ev as MouseEvent).clientX;
      const startWidth = liveWidths[i];
      const onMove = (mv: MouseEvent) => {
        liveWidths[i] = Math.max(MIN_COL_WIDTH, startWidth + (mv.clientX - startX));
        applyWidths();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        options.onColumnResize?.(col.label, liveWidths[i]);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    headerCell.appendChild(handle);
    header.appendChild(headerCell);
  });

  const sizer = el('div', { style: `position:relative;width:${totalWidthPx()}px;min-width:${totalWidthPx()}px;` });
  const viewport = el('div', { style: 'position:absolute;top:0;left:0;right:0;' });
  sizer.appendChild(viewport);
  host.append(header, sizer);

  /** ドラッグ中、grid-template-columns/幅を再計算せず全体を再描画すると重いため、
   *  該当スタイルだけを直接書き換えて軽量に追従させる。 */
  function applyWidths(): void {
    const cols = gridColumnsStr();
    const total = totalWidthPx();
    header.style.gridTemplateColumns = cols;
    header.style.width = `${total}px`;
    header.style.minWidth = `${total}px`;
    sizer.style.width = `${total}px`;
    sizer.style.minWidth = `${total}px`;
    viewport.querySelectorAll<HTMLElement>('.vgrid-row').forEach((row) => {
      row.style.gridTemplateColumns = cols;
    });
  }

  let rafId: number | null = null;

  function draw(): void {
    sizer.style.height = `${rowCount * rowHeight}px`;
    const headerHeight = header.offsetHeight;
    const clientHeight = Math.max(0, (host.clientHeight || 400) - headerHeight);
    const scrollTop = Math.min(host.scrollTop, Math.max(0, rowCount * rowHeight - clientHeight));
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
    const visibleCount = Math.ceil(clientHeight / rowHeight) + OVERSCAN * 2;
    const end = Math.min(rowCount, start + visibleCount);

    viewport.style.transform = `translateY(${start * rowHeight}px)`;
    viewport.innerHTML = '';
    for (let i = start; i < end; i++) {
      const extraClass = options.rowClassName?.(i);
      const row = el('div', {
        class: `vgrid-row${extraClass ? ` ${extraClass}` : ''}`,
        style: `display:grid;grid-template-columns:${gridColumnsStr()};height:${rowHeight}px;align-items:center;`,
      });
      for (const cellContent of options.renderRow(i)) {
        const cell = el('div', {
          style: 'padding:0 8px;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
        });
        cell.append(cellContent);
        row.appendChild(cell);
      }
      viewport.appendChild(row);
    }
  }

  function scheduleDraw(): void {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      draw();
    });
  }

  host.addEventListener('scroll', scheduleDraw);
  window.addEventListener('resize', scheduleDraw);
  draw();

  return {
    refresh: (newRowCount?: number) => {
      if (newRowCount !== undefined) rowCount = newRowCount;
      draw();
    },
    scrollToIndex: (index: number) => {
      // sizerはheader分の高さだけ下にあるが、sticky headerは通常の
      // レイアウトフロー上ではheader自身の高さぶんスペースを占有し続ける
      // ため、host.scrollTopは(headerの高さを足さずに)そのままindex*rowHeight
      // でsizer内のその行を可視領域の先頭に合わせられる (draw()内のstart算出
      // と同じ考え方)。
      host.scrollTop = index * rowHeight;
      draw();
    },
  };
}
