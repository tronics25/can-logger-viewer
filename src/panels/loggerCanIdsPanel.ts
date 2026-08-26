// Logger CAN ID設定 (Logger 1〜6 ⇔ 実CAN ID) エディタ
import * as vscode from 'vscode';
import { LoggerCanIdsFile } from '../models/types';
import { loadLoggerCanIds, saveLoggerCanIds } from '../storage/workspaceStore';
import { buildHtml } from './webviewUtils';

let currentPanel: vscode.WebviewPanel | undefined;

export function openLoggerCanIdsPanel(extensionUri: vscode.Uri): void {
  if (currentPanel) {
    currentPanel.reveal();
    postInit();
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    'canLogger.loggerCanIds',
    'Logger CAN ID設定',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  currentPanel.webview.html = buildHtml(currentPanel.webview, extensionUri, 'loggerCanIds', 'Logger CAN ID設定');

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
  });

  currentPanel.webview.onDidReceiveMessage((msg) => {
    if (msg.type === 'ready') postInit();
    if (msg.type === 'save') saveLoggerCanIds(msg.data as LoggerCanIdsFile);
  });
}

function postInit(): void {
  currentPanel?.webview.postMessage({ type: 'init', data: loadLoggerCanIds() });
}
