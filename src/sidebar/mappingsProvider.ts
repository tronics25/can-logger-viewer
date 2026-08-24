// サイドバー: Loggerマッピングプロファイル + Logger CAN ID設定への入口
import * as vscode from 'vscode';
import { LoggerMappingProfile } from '../models/types';
import { loadLoggerMappings, onDidChangeStore } from '../storage/workspaceStore';

type Node = { kind: 'profile'; profile: LoggerMappingProfile } | { kind: 'settings' };

export class MappingsProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor() {
    onDidChangeStore((filename) => {
      if (filename === 'logger-mappings.json' || filename === 'logger-can-ids.json') this.refresh();
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'settings') {
      const ti = new vscode.TreeItem('Logger CAN ID設定 (1〜5)', vscode.TreeItemCollapsibleState.None);
      ti.iconPath = new vscode.ThemeIcon('settings-gear');
      ti.command = { command: 'canLogger.openLoggerCanIdSettings', title: 'Logger CAN ID設定' };
      return ti;
    }
    const ti = new vscode.TreeItem(node.profile.name, vscode.TreeItemCollapsibleState.None);
    ti.iconPath = new vscode.ThemeIcon('link');
    ti.contextValue = 'canLogger.mappingProfile';
    ti.command = {
      command: 'canLogger.openMappingProfile',
      title: 'マッピングプロファイルを開く',
      arguments: [node.profile.id],
    };
    return ti;
  }

  getChildren(element?: Node): Node[] {
    if (element) return [];
    const data = loadLoggerMappings();
    const profileNodes: Node[] = data.profiles.map((profile) => ({ kind: 'profile', profile }));
    return [...profileNodes, { kind: 'settings' }];
  }
}
