// サイドバー: Loggerマッピングプロファイル一覧。
// Logger CAN ID設定へはこのビュー自体のタイトルバーの歯車アイコン
// (canLogger.openLoggerCanIdSettings、package.jsonのview/title参照) から
// 開けるため、リスト項目として重複して出す必要はない。
import * as vscode from 'vscode';
import { LoggerMappingProfile } from '../models/types';
import { loadLoggerMappings, onDidChangeStore } from '../storage/workspaceStore';

type Node = { kind: 'profile'; profile: LoggerMappingProfile };

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
    return data.profiles.map((profile) => ({ kind: 'profile', profile }));
  }
}
