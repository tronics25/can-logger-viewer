// サイドバー: 最近開いたログファイル
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getRecentLogs } from '../storage/workspaceStore';

export class RecentLogsProvider implements vscode.TreeDataProvider<string> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly memento: vscode.Memento) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(filePath: string): vscode.TreeItem {
    const ti = new vscode.TreeItem(path.basename(filePath), vscode.TreeItemCollapsibleState.None);
    ti.description = filePath;
    ti.iconPath = new vscode.ThemeIcon('file');
    ti.command = {
      command: 'vscode.open',
      title: 'ログを開く',
      arguments: [vscode.Uri.file(filePath)],
    };
    return ti;
  }

  getChildren(element?: string): string[] {
    if (element) return [];
    return getRecentLogs(this.memento).filter((p) => fs.existsSync(p));
  }
}
