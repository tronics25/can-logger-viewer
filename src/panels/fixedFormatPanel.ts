// 固定フォーマットフレーム定義 エディタ (Webviewパネル)
import * as vscode from 'vscode';
import { FixedFormatCanIdEntry } from '../models/types';
import {
  ensureWorkspaceOpen,
  exportToFile,
  importFromFile,
  loadFixedFormat,
  saveFixedFormat,
} from '../storage/workspaceStore';
import { buildHtml } from './webviewUtils';

const panels = new Map<string, vscode.WebviewPanel>();

export function openFixedFormatPanel(extensionUri: vscode.Uri, entryId: string): void {
  const existing = panels.get(entryId);
  if (existing) {
    existing.reveal();
    postInit(existing, entryId);
    return;
  }

  const file = loadFixedFormat();
  const entry = file.entries.find((e) => e.id === entryId);
  if (!entry) {
    vscode.window.showErrorMessage('固定フォーマットフレームが見つかりません。');
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'canLogger.fixedFormat',
    entry.name,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = buildHtml(panel.webview, extensionUri, 'fixedFormat', entry.name);
  panels.set(entryId, panel);
  panel.onDidDispose(() => panels.delete(entryId));

  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.type) {
      case 'ready':
        postInit(panel, entryId);
        break;
      case 'save': {
        const data = msg.data as FixedFormatCanIdEntry;
        const f = loadFixedFormat();
        const idx = f.entries.findIndex((e) => e.id === entryId);
        if (idx >= 0) {
          f.entries[idx] = data;
          saveFixedFormat(f);
          panel.title = data.name;
        }
        break;
      }
      case 'export': {
        const uri = await vscode.window.showSaveDialog({
          filters: { JSON: ['json'] },
          defaultUri: vscode.Uri.file(`${entry.name}.json`),
        });
        if (uri) {
          const f = loadFixedFormat();
          exportToFile(f.entries.find((e) => e.id === entryId), uri.fsPath);
          vscode.window.showInformationMessage(`エクスポートしました: ${uri.fsPath}`);
        }
        break;
      }
      case 'import': {
        const uris = await vscode.window.showOpenDialog({ filters: { JSON: ['json'] }, canSelectMany: false });
        if (uris && uris[0]) {
          try {
            const imported = importFromFile<FixedFormatCanIdEntry>(uris[0].fsPath);
            const f = loadFixedFormat();
            const idx = f.entries.findIndex((e) => e.id === entryId);
            if (idx >= 0) {
              f.entries[idx] = { ...imported, id: entryId };
              saveFixedFormat(f);
              postInit(panel, entryId);
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

function postInit(panel: vscode.WebviewPanel, entryId: string): void {
  const entry = loadFixedFormat().entries.find((e) => e.id === entryId);
  panel.webview.postMessage({ type: 'init', entry });
}

export function createFixedFormatEntry(): void {
  if (!ensureWorkspaceOpen()) return;
  vscode.window.showInputBox({ prompt: 'CAN ID (例: 2A0, 3B012400x)' }).then((idText) => {
    if (!idText) return;
    vscode.window.showInputBox({ prompt: 'CANフレーム名', value: '新規フレーム' }).then((name) => {
      if (!name) return;
      const extended = idText.trim().toLowerCase().endsWith('x');
      const hex = extended ? idText.trim().slice(0, -1) : idText.trim();
      const id = parseInt(hex, 16);
      if (Number.isNaN(id)) {
        vscode.window.showErrorMessage('CAN IDの形式が不正です。');
        return;
      }
      const file = loadFixedFormat();
      file.entries.push({
        id: `ff-${Date.now().toString(36)}`,
        canId: { id, extended },
        name,
        frameLength: 8,
        signals: [],
      });
      saveFixedFormat(file);
    });
  });
}

export function deleteFixedFormatEntry(entryId: string): void {
  const file = loadFixedFormat();
  file.entries = file.entries.filter((e) => e.id !== entryId);
  saveFixedFormat(file);
  panels.get(entryId)?.dispose();
}
