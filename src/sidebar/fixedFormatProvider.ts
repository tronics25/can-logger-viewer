// サイドバー: 固定フォーマットフレーム (名称順)
import * as vscode from 'vscode';
import { FixedFormatCanIdEntry } from '../models/types';
import { formatCanId } from '../decode/canId';
import { loadFixedFormat, onDidChangeStore } from '../storage/workspaceStore';

export class FixedFormatProvider implements vscode.TreeDataProvider<FixedFormatCanIdEntry> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<FixedFormatCanIdEntry | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor() {
    onDidChangeStore((filename) => {
      if (filename === 'fixed-format.json') this.refresh();
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(entry: FixedFormatCanIdEntry): vscode.TreeItem {
    const isFd = entry.frameLength > 8;
    const ti = new vscode.TreeItem(entry.name, vscode.TreeItemCollapsibleState.None);
    ti.description = `${formatCanId(entry.canId)} ・ ${entry.signals.length}信号${isFd ? ` ・ CAN FD ${entry.frameLength}B` : ''}`;
    ti.iconPath = new vscode.ThemeIcon('symbol-array');
    ti.contextValue = 'canLogger.fixedFormatEntry';
    ti.command = {
      command: 'canLogger.openFixedFormatCanId',
      title: '固定フォーマットフレームを開く',
      arguments: [entry.id],
    };
    return ti;
  }

  getChildren(element?: FixedFormatCanIdEntry): FixedFormatCanIdEntry[] {
    if (element) return [];
    const data = loadFixedFormat();
    return [...data.entries].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }
}
