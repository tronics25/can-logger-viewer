// サイドバー: Logger項目仕様 (分類番号でグルーピングしたツリー)
import * as vscode from 'vscode';
import { LoggerCategory, LoggerItemSpec, dataNumberRangeLabel } from '../models/types';
import { loadLoggerSpecs, onDidChangeStore } from '../storage/workspaceStore';

type Node =
  | { kind: 'category'; category: LoggerCategory; itemCount: number }
  | { kind: 'item'; item: LoggerItemSpec };

export class ItemSpecsProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor() {
    onDidChangeStore((filename) => {
      if (filename === 'logger-specs.json') this.refresh();
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'category') {
      const ti = new vscode.TreeItem(
        `${node.category.number}: ${node.category.name}`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      ti.description = `${node.itemCount}件`;
      ti.contextValue = 'canLogger.category';
      ti.iconPath = new vscode.ThemeIcon('folder');
      return ti;
    }
    const ti = new vscode.TreeItem(node.item.name, vscode.TreeItemCollapsibleState.None);
    ti.description = dataNumberRangeLabel(node.item);
    ti.contextValue = 'canLogger.item';
    ti.iconPath = new vscode.ThemeIcon('symbol-field');
    ti.command = {
      command: 'canLogger.editItemSpec',
      title: '項目を編集',
      arguments: [node.item.id],
    };
    return ti;
  }

  getChildren(element?: Node): Node[] {
    const data = loadLoggerSpecs();
    if (!element) {
      return [...data.categories]
        .sort((a, b) => a.number - b.number)
        .map((category) => ({
          kind: 'category' as const,
          category,
          itemCount: data.items.filter((i) => i.categoryNumber === category.number).length,
        }));
    }
    if (element.kind === 'category') {
      return data.items
        .filter((i) => i.categoryNumber === element.category.number)
        .sort((a, b) => a.dataNumber - b.dataNumber)
        .map((item) => ({ kind: 'item' as const, item }));
    }
    return [];
  }
}
