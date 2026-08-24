// Logger項目仕様エディタ (Webviewパネル)
import * as vscode from 'vscode';
import { LoggerSpecsFile } from '../models/types';
import {
  ensureWorkspaceOpen,
  exportToFile,
  importFromFile,
  loadLoggerSpecs,
  onDidChangeStore,
  saveLoggerSpecs,
} from '../storage/workspaceStore';
import { buildHtml } from './webviewUtils';

let currentPanel: vscode.WebviewPanel | undefined;

export function openItemSpecsPanel(extensionUri: vscode.Uri, focusItemId?: string): void {
  if (currentPanel) {
    currentPanel.reveal();
    postInit(focusItemId);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    'canLogger.itemSpecs',
    'Logger項目仕様',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  currentPanel.webview.html = buildHtml(currentPanel.webview, extensionUri, 'itemSpecs', 'Logger項目仕様');

  const storeSub = onDidChangeStore((filename) => {
    if (filename === 'logger-specs.json') postInit();
  });

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
    storeSub.dispose();
  });

  currentPanel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.type) {
      case 'ready':
        postInit(focusItemId);
        break;
      case 'save':
        saveLoggerSpecs(msg.data as LoggerSpecsFile);
        break;
      case 'newCategory':
        await createCategory(extensionUri);
        break;
      case 'export': {
        const uri = await vscode.window.showSaveDialog({
          filters: { JSON: ['json'] },
          defaultUri: vscode.Uri.file('logger-specs.json'),
        });
        if (uri) {
          exportToFile(loadLoggerSpecs(), uri.fsPath);
          vscode.window.showInformationMessage(`エクスポートしました: ${uri.fsPath}`);
        }
        break;
      }
      case 'import': {
        const uris = await vscode.window.showOpenDialog({ filters: { JSON: ['json'] }, canSelectMany: false });
        if (uris && uris[0]) {
          try {
            const data = importFromFile<LoggerSpecsFile>(uris[0].fsPath);
            saveLoggerSpecs(data);
            postInit();
          } catch (e) {
            vscode.window.showErrorMessage(`インポートに失敗しました: ${(e as Error).message}`);
          }
        }
        break;
      }
    }
  });
}

function postInit(focusItemId?: string): void {
  currentPanel?.webview.postMessage({ type: 'init', data: loadLoggerSpecs(), focusItemId });
}

/**
 * 分類番号は任意の値を指定できる (連番を強制しない)。数値入力＋重複チェックは
 * ネイティブのVS Code入力ボックスで行う (Webview内の alert/prompt はサンドボックス
 * により表示されないことがあるため使わない)。
 */
export async function createCategory(extensionUri: vscode.Uri): Promise<void> {
  if (!ensureWorkspaceOpen()) return;
  const data = loadLoggerSpecs();

  const numberText = await vscode.window.showInputBox({
    prompt: '分類番号を入力してください（任意の数値、既存と重複しないもの）',
    placeHolder: '例: 21',
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!/^\d+$/.test(trimmed)) return '0以上の整数を入力してください';
      const n = parseInt(trimmed, 10);
      if (data.categories.some((c) => c.number === n)) return `分類番号 ${n} は既に登録されています`;
      return null;
    },
  });
  if (numberText === undefined) return;
  const number = parseInt(numberText.trim(), 10);

  const name = await vscode.window.showInputBox({
    prompt: '分類名を入力してください',
    value: '新規分類',
  });
  if (name === undefined) return;

  data.categories.push({ number, name });
  saveLoggerSpecs(data);
  openItemSpecsPanel(extensionUri);
}
