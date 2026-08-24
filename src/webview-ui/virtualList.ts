// 依存ライブラリなしの仮想スクロールテーブル。
// 数万行規模のログでも、実際に画面に見えている行だけをDOMに生成することで
// スクロールを軽快に保つ (行の高さは固定を前提とする)。
import { el } from './common';

export interface VirtualColumn {
  label: string;
  /** CSS gridのトラックサイズ (例: "90px", "1fr", "minmax(100px,1fr)") */
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

export function renderVirtualTable(host: HTMLElement, options: VirtualTableOptions): VirtualTableHandle {
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const gridColumns = options.columns.map((c) => c.width).join(' ');
  let rowCount = options.rowCount;

  host.innerHTML = '';
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.style.minHeight = '0';
  host.style.border = '1px solid var(--vscode-panel-border)';
  host.style.borderRadius = '4px';
  if (options.height) host.style.height = options.height;
  else host.style.flex = '1';

  if (rowCount === 0) {
    host.appendChild(el('div', { class: 'sub', style: 'padding:12px' }, [options.emptyMessage ?? 'データがありません。']));
    return { refresh: () => {}, scrollToIndex: () => {} };
  }

  const header = el('div', {
    style: `display:grid;grid-template-columns:${gridColumns};flex:0 0 auto;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);`,
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

  const body = el('div', { style: 'position:relative;flex:1;min-height:0;overflow-y:auto;' });
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
