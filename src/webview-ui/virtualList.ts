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
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.style.minHeight = '0';
  host.style.border = '1px solid var(--vscode-panel-border)';
  host.style.borderRadius = '4px';
  // 列の合計幅がホスト幅を超えたら横スクロールできるようにする。ヘッダーと
  // 行本体(body)の両方を同じtotalWidthに固定することで、横スクロール時も
  // 常にヘッダーと列が揃った状態で一緒に動く。
  // overflow-xだけをautoにするとCSSの仕様上overflow-yも暗黙にautoへ昇格し、
  // body側の縦スクロールと二重になってしまうため、overflow-yは明示的に
  // hidden指定して縦スクロールはbody側だけに閉じ込める。
  host.style.overflowX = 'auto';
  host.style.overflowY = 'hidden';
  if (options.height) host.style.height = options.height;
  else host.style.flex = '1';

  if (rowCount === 0) {
    host.appendChild(el('div', { class: 'sub', style: 'padding:12px' }, [options.emptyMessage ?? 'データがありません。']));
    return { refresh: () => {}, scrollToIndex: () => {} };
  }

  const header = el('div', {
    style:
      `display:grid;grid-template-columns:${gridColumns};flex:0 0 auto;width:${totalWidth}px;min-width:${totalWidth}px;` +
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

  const body = el('div', {
    style: `position:relative;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;width:${totalWidth}px;min-width:${totalWidth}px;`,
  });
  const sizer = el('div', { style: 'position:relative;' });
  const viewport = el('div', { style: 'position:absolute;top:0;left:0;right:0;' });
  sizer.appendChild(viewport);
  body.appendChild(sizer);
  host.append(header, body);

  let rafId: number | null = null;

  function draw(): void {
    sizer.style.height = `${rowCount * rowHeight}px`;
    const clientHeight = body.clientHeight || 400;
    const scrollTop = Math.min(body.scrollTop, Math.max(0, rowCount * rowHeight - clientHeight));
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

  body.addEventListener('scroll', scheduleDraw);
  window.addEventListener('resize', scheduleDraw);
  draw();

  return {
    refresh: (newRowCount?: number) => {
      if (newRowCount !== undefined) rowCount = newRowCount;
      draw();
    },
    scrollToIndex: (index: number) => {
      body.scrollTop = index * rowHeight;
      draw();
    },
  };
}
