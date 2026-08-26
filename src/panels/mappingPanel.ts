// Loggerマッピングプロファイル エディタ (Webviewパネル)
import * as vscode from 'vscode';
import { LoggerMappingProfile } from '../models/types';
import {
  ensureWorkspaceOpen,
  exportToFile,
  importFromFile,
  loadLoggerCanIds,
  loadLoggerMappings,
  loadLoggerSpecs,
  saveLoggerMappings,
} from '../storage/workspaceStore';
import { buildHtml } from './webviewUtils';

// プロファイルIDごとにパネルを1つ保持する。
const panels = new Map<string, vscode.WebviewPanel>();

export function openMappingPanel(extensionUri: vscode.Uri, profileId: string): void {
  const existing = panels.get(profileId);
  if (existing) {
    existing.reveal();
    postInit(existing, profileId);
    return;
  }

  const mappings = loadLoggerMappings();
  const profile = mappings.profiles.find((p) => p.id === profileId);
  if (!profile) {
    vscode.window.showErrorMessage('マッピングプロファイルが見つかりません。');
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'canLogger.mapping',
    `マッピング: ${profile.name}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = buildHtml(panel.webview, extensionUri, 'mapping', profile.name);
  panels.set(profileId, panel);

  panel.onDidDispose(() => panels.delete(profileId));

  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.type) {
      case 'ready':
        postInit(panel, profileId);
        break;
      case 'save': {
        const data = msg.data as LoggerMappingProfile;
        const file = loadLoggerMappings();
        const idx = file.profiles.findIndex((p) => p.id === profileId);
        if (idx >= 0) {
          file.profiles[idx] = data;
          saveLoggerMappings(file);
          if (data.name !== profile.name) panel.title = `マッピング: ${data.name}`;
        }
        break;
      }
      case 'export': {
        const uri = await vscode.window.showSaveDialog({
          filters: { JSON: ['json'] },
          defaultUri: vscode.Uri.file(`${profile.name}.json`),
        });
        if (uri) {
          const file = loadLoggerMappings();
          const current = file.profiles.find((p) => p.id === profileId);
          exportToFile(current, uri.fsPath);
          vscode.window.showInformationMessage(`エクスポートしました: ${uri.fsPath}`);
        }
        break;
      }
      case 'import': {
        const uris = await vscode.window.showOpenDialog({ filters: { JSON: ['json'] }, canSelectMany: false });
        if (uris && uris[0]) {
          try {
            const imported = importFromFile<LoggerMappingProfile>(uris[0].fsPath);
            const file = loadLoggerMappings();
            const idx = file.profiles.findIndex((p) => p.id === profileId);
            if (idx >= 0) {
              file.profiles[idx] = { ...imported, id: profileId };
              saveLoggerMappings(file);
              postInit(panel, profileId);
            }
          } catch (e) {
            vscode.window.showErrorMessage(`インポートに失敗しました: ${(e as Error).message}`);
          }
        }
        break;
      }
    }
  });
}

function postInit(panel: vscode.WebviewPanel, profileId: string): void {
  const file = loadLoggerMappings();
  const profile = file.profiles.find((p) => p.id === profileId);
  const specs = loadLoggerSpecs();
  panel.webview.postMessage({
    type: 'init',
    profile,
    items: specs.items,
    categories: specs.categories,
    canIds: loadLoggerCanIds(),
  });
}

export function createMappingProfile(): void {
  if (!ensureWorkspaceOpen()) return;
  vscode.window
    .showInputBox({ prompt: '新しいマッピングプロファイル名', value: 'New Mapping' })
    .then((name) => {
      if (!name) return;
      const file = loadLoggerMappings();
      const id = `profile-${Date.now().toString(36)}`;
      file.profiles.push(makeEmptyProfile(id, name));
      saveLoggerMappings(file);
    });
}

export function duplicateMappingProfile(profileId: string): void {
  const file = loadLoggerMappings();
  const source = file.profiles.find((p) => p.id === profileId);
  if (!source) return;
  const id = `profile-${Date.now().toString(36)}`;
  file.profiles.push({ ...structuredClone(source), id, name: `${source.name} のコピー` });
  saveLoggerMappings(file);
}

export function deleteMappingProfile(profileId: string): void {
  const file = loadLoggerMappings();
  file.profiles = file.profiles.filter((p) => p.id !== profileId);
  saveLoggerMappings(file);
  panels.get(profileId)?.dispose();
}

function makeEmptyProfile(id: string, name: string): LoggerMappingProfile {
  const emptySlots = () => Array.from({ length: 8 }, (_, i) => ({ slot: i, itemId: null }));
  return {
    id,
    name,
    slots: { 1: emptySlots(), 2: emptySlots(), 3: emptySlots(), 4: emptySlots(), 5: emptySlots(), 6: emptySlots() },
  };
}
