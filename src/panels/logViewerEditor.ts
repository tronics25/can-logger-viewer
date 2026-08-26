// CustomReadonlyEditorProvider: .asc / .blf を開いたときのメインビューア。
// 「生ログ」タブ (汎用CANトレース) と「Logger」タブ (Loggerマッピング適用) を持つ。
import * as fs from 'fs';
import * as vscode from 'vscode';
import { parseAsc } from '../parsers/ascParser';
import { parseBlf } from '../parsers/blfParser';
import { ParseResult } from '../models/types';
import {
  addRecentLog,
  loadFixedFormat,
  loadLoggerCanIds,
  loadLoggerMappings,
  loadLoggerSpecs,
  onDidChangeStore,
} from '../storage/workspaceStore';
import { buildHtml } from './webviewUtils';

class LogDocument implements vscode.CustomDocument {
  constructor(public readonly uri: vscode.Uri, public readonly parseResult: ParseResult) {}
  dispose(): void {
    /* no-op */
  }
}

export class LogViewerEditorProvider implements vscode.CustomReadonlyEditorProvider<LogDocument> {
  constructor(private readonly extensionUri: vscode.Uri, private readonly memento: vscode.Memento) {}

  async openCustomDocument(uri: vscode.Uri): Promise<LogDocument> {
    const ext = uri.fsPath.toLowerCase().split('.').pop();
    let result: ParseResult;
    if (ext === 'blf') {
      const buffer = fs.readFileSync(uri.fsPath);
      result = parseBlf(buffer);
    } else {
      const text = fs.readFileSync(uri.fsPath, 'utf-8');
      result = parseAsc(text);
    }
    await addRecentLog(this.memento, uri.fsPath);
    return new LogDocument(uri, result);
  }

  resolveCustomEditor(document: LogDocument, webviewPanel: vscode.WebviewPanel): void {
    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = buildHtml(webviewPanel.webview, this.extensionUri, 'logViewer', document.uri.fsPath);

    const postInit = () => {
      webviewPanel.webview.postMessage({
        type: 'init',
        fileName: document.uri.fsPath.split(/[/\\]/).pop(),
        frames: document.parseResult.frames.map((f) => ({
          t: f.timestamp,
          canId: f.canId,
          extended: f.extended,
          dir: f.dir,
          channel: f.channel,
          dlc: f.dlc,
          dlcCode: f.dlcCode,
          data: Array.from(f.data),
        })),
        warnings: document.parseResult.warnings,
        fixedFormat: loadFixedFormat().entries,
        loggerSpecs: loadLoggerSpecs(),
        loggerCanIds: loadLoggerCanIds(),
        loggerMappings: loadLoggerMappings(),
      });
    };

    const storeSub = onDidChangeStore(() => {
      webviewPanel.webview.postMessage({
        type: 'registriesUpdated',
        fixedFormat: loadFixedFormat().entries,
        loggerSpecs: loadLoggerSpecs(),
        loggerCanIds: loadLoggerCanIds(),
        loggerMappings: loadLoggerMappings(),
      });
    });
    webviewPanel.onDidDispose(() => storeSub.dispose());

    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'ready') {
        postInit();
      } else if (msg.type === 'exportCsv') {
        const uri = await vscode.window.showSaveDialog({
          filters: { CSV: ['csv'] },
          defaultUri: vscode.Uri.file(msg.suggestedName ?? 'export.csv'),
        });
        if (uri) {
          fs.writeFileSync(uri.fsPath, msg.csv, 'utf-8');
          vscode.window.showInformationMessage(`CSVを書き出しました: ${uri.fsPath}`);
        }
      } else if (msg.type === 'importCsv') {
        // 時系列グラフでの比較用に、外部CSVを読み込んでwebviewへ渡す
        // (パース自体はwebview側で行う。ここではファイル選択と読み込みのみ)。
        const uris = await vscode.window.showOpenDialog({ filters: { CSV: ['csv'] }, canSelectMany: false });
        if (uris && uris[0]) {
          try {
            const content = fs.readFileSync(uris[0].fsPath, 'utf-8');
            webviewPanel.webview.postMessage({
              type: 'csvFileLoaded',
              fileName: uris[0].fsPath.split(/[/\\]/).pop(),
              content,
            });
          } catch (e) {
            vscode.window.showErrorMessage(`CSVの読み込みに失敗しました: ${(e as Error).message}`);
          }
        }
      }
    });
  }
}
