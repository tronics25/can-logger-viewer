// 依存ライブラリなしの仮想スクロールテーブル。
// 数万行規模のログでも、実際に画面に見えている行だけをDOMに生成することで
// スクロールを軽快に保つ (行の高さは固定を前提とする)。
import { el } from './common';

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
}

export interface VirtualTableHandle {
  /** データ件数や内容が変わった際に再描画する */
  refresh(rowCount?: number): void;
  scrollToIndex(index: number): void;
}

const DEFAULT_ROW_HEIGHT = 26;
const OVERSCAN = 6;

/** セル1つ分のpadding (左右合計)。measureMaxCellWidthの実測にも使う。 */
const CELL_PADDING_PX = 16;
const MIN_MEASURED_WIDTH = 80;
const MAX_MEASURED_WIDTH = 2200;

/**
 * 候補となるセル内容 (Node/文字列) の中で最も幅を取るものを実際にDOMへ
 * 一時挿入して計測し、そのpx幅を返す (列幅を実データに合わせて決めるための
 * ヘルパー。ヘッダーと全行が同じ固定px幅を使うことで、横スクロール時にも
 * ヘッダーと行がズレないようにする)。
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

export function renderVirtualTable(host: HTMLElement, options: VirtualTableOptions): VirtualTableHandle {
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const gridColumns = options.columns.map((c) => c.width).join(' ');
  const totalWidth = options.columns.reduce((sum, c) => sum + (parseInt(c.width, 10) || 0), 0);
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
      `display:grid;grid-template-columns:${gridColumns};width:${totalWidth}px;min-width:${totalWidth}px;` +
      'position:sticky;top:0;z-index:1;' +
      'border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);',
  });
  for (const col of options.columns) {
    header.appendChild(
      el(
        'div',
        {
          style:
            'padding:6px 8px;font-size:10.5px;text-transform:uppercase;letter-spacing:0.02em;' +
            'color:var(--vscode-descriptionForeground);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
        },
        [col.label]
      )
    );
  }

  const sizer = el('div', { style: `position:relative;width:${totalWidth}px;min-width:${totalWidth}px;` });
  const viewport = el('div', { style: 'position:absolute;top:0;left:0;right:0;' });
  sizer.appendChild(viewport);
  host.append(header, sizer);

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
        style: `display:grid;grid-template-columns:${gridColumns};height:${rowHeight}px;align-items:center;`,
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
