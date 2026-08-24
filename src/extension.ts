// CAN Logger Viewer 拡張機能のエントリポイント。
// サイドバー(TreeView)・各種Webviewパネル・カスタムエディタを登録する。
import * as vscode from 'vscode';
import { ItemSpecsProvider } from './sidebar/itemSpecsProvider';
import { MappingsProvider } from './sidebar/mappingsProvider';
import { FixedFormatProvider } from './sidebar/fixedFormatProvider';
import { RecentLogsProvider } from './sidebar/recentLogsProvider';
import { createCategory, openItemSpecsPanel } from './panels/itemSpecsPanel';
import { openLoggerCanIdsPanel } from './panels/loggerCanIdsPanel';
import {
  createMappingProfile,
  deleteMappingProfile,
  duplicateMappingProfile,
  openMappingPanel,
} from './panels/mappingPanel';
import { createFixedFormatEntry, deleteFixedFormatEntry, openFixedFormatPanel } from './panels/fixedFormatPanel';
import { LogViewerEditorProvider } from './panels/logViewerEditor';
import { loadLoggerSpecs, saveLoggerSpecs } from './storage/workspaceStore';

export function activate(context: vscode.ExtensionContext): void {
  const extensionUri = context.extensionUri;

  // --- サイドバー ---------------------------------------------------------
  const itemSpecsProvider = new ItemSpecsProvider();
  const mappingsProvider = new MappingsProvider();
  const fixedFormatProvider = new FixedFormatProvider();
  const recentLogsProvider = new RecentLogsProvider(context.workspaceState);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('canLogger.itemSpecs', itemSpecsProvider),
    vscode.window.registerTreeDataProvider('canLogger.mappings', mappingsProvider),
    vscode.window.registerTreeDataProvider('canLogger.fixedFormat', fixedFormatProvider),
    vscode.window.registerTreeDataProvider('canLogger.recentLogs', recentLogsProvider)
  );

  // --- カスタムエディタ (.asc / .blf) --------------------------------------
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'canLogger.logViewer',
      new LogViewerEditorProvider(extensionUri, context.workspaceState),
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // --- コマンド ------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('canLogger.openLog', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'CANログ': ['asc', 'blf'] },
      });
      if (uris && uris[0]) {
        await vscode.commands.executeCommand('vscode.openWith', uris[0], 'canLogger.logViewer');
        recentLogsProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('canLogger.newCategory', () => createCategory(extensionUri)),
    vscode.commands.registerCommand('canLogger.editItemSpec', (itemId?: string) =>
      openItemSpecsPanel(extensionUri, itemId)
    ),
    vscode.commands.registerCommand('canLogger.deleteItemSpec', async (node?: { item?: { id: string; name: string } }) => {
      const item = node?.item;
      if (!item) return;
      const yes = await vscode.window.showWarningMessage(`項目「${item.name}」を削除しますか？`, { modal: true }, '削除');
      if (yes !== '削除') return;
      const data = loadLoggerSpecs();
      data.items = data.items.filter((i) => i.id !== item.id);
      saveLoggerSpecs(data);
    }),
    vscode.commands.registerCommand(
      'canLogger.deleteCategory',
      async (node?: { category?: { number: number; name: string } }) => {
        const category = node?.category;
        if (!category) return;
        const data = loadLoggerSpecs();
        if (data.items.some((i) => i.categoryNumber === category.number)) {
          vscode.window.showErrorMessage('この分類には項目が残っています。先に項目を削除または移動してください。');
          return;
        }
        data.categories = data.categories.filter((c) => c.number !== category.number);
        saveLoggerSpecs(data);
      }
    ),

    vscode.commands.registerCommand('canLogger.newMappingProfile', createMappingProfile),
    vscode.commands.registerCommand('canLogger.openMappingProfile', (profileId: string) =>
      openMappingPanel(extensionUri, profileId)
    ),
    vscode.commands.registerCommand('canLogger.duplicateMappingProfile', (node?: { profile?: { id: string } }) => {
      if (node?.profile) duplicateMappingProfile(node.profile.id);
    }),
    vscode.commands.registerCommand('canLogger.deleteMappingProfile', async (node?: { profile?: { id: string; name: string } }) => {
      const profile = node?.profile;
      if (!profile) return;
      const yes = await vscode.window.showWarningMessage(
        `マッピングプロファイル「${profile.name}」を削除しますか？`,
        { modal: true },
        '削除'
      );
      if (yes === '削除') deleteMappingProfile(profile.id);
    }),
    vscode.commands.registerCommand('canLogger.openLoggerCanIdSettings', () => openLoggerCanIdsPanel(extensionUri)),

    vscode.commands.registerCommand('canLogger.newFixedFormatCanId', createFixedFormatEntry),
    vscode.commands.registerCommand('canLogger.openFixedFormatCanId', (entryId: string) =>
      openFixedFormatPanel(extensionUri, entryId)
    ),
    vscode.commands.registerCommand(
      'canLogger.deleteFixedFormatCanId',
      async (entry?: { id: string; name: string }) => {
        if (!entry) return;
        const yes = await vscode.window.showWarningMessage(`「${entry.name}」を削除しますか？`, { modal: true }, '削除');
        if (yes === '削除') deleteFixedFormatEntry(entry.id);
      }
    ),

    vscode.commands.registerCommand('canLogger.refreshViews', () => {
      itemSpecsProvider.refresh();
      mappingsProvider.refresh();
      fixedFormatProvider.refresh();
      recentLogsProvider.refresh();
    })
  );
}

export function deactivate(): void {
  /* no-op */
}
